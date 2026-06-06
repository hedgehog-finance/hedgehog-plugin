import { getDB } from "../../core/database.js";
import {
	BuildInformationVerificationMessageParams,
	BuildInformationVerificationMessageParamsSchema,
	GetInformationVerificationDetailParamsSchema,
	QueryInformationVerificationHistoryParamsSchema
} from "./schema.js";

interface RuntimeTool {
	name: string;
	label?: string;
	description: string;
	parameters: unknown;
	registerTool?: boolean;
	execute(params: unknown, ctx?: { userId: string }): Promise<string>;
}

const INFORMATION_VERIFICATION_SKILL = "hedgehog-information-verification";

const BuildInformationVerificationMessageAgentToolSchema = {
	type: "object",
	additionalProperties: false,
	required: ["newsId", "sourceTitle", "sourceContent"],
	properties: {
		newsId: { type: "string", description: "新闻 ID，例如 news-5" },
		sourceTitle: { type: "string", description: "新闻标题" },
		sourceContent: { type: "string", description: "新闻正文" }
	}
};

function buildContent(args: BuildInformationVerificationMessageParams): string {
	return [
		"对这条新闻进行信息求证",
		"",
		`新闻标题：${args.sourceTitle}`,
		"",
		"新闻正文：",
		args.sourceContent
	].join("\n");
}

function buildInformationVerificationMessage(args: BuildInformationVerificationMessageParams): string {
	const buildGeneratingSaveParams = () => JSON.stringify({
		sourceId: args.newsId,
		sourceTitle: args.sourceTitle,
		status: "generating",
		content: ""
	});
	const buildFinalSaveParams = (status: "completed" | "failed") => JSON.stringify({
		sourceId: args.newsId,
		status,
		content: "..."
	});
	return JSON.stringify({
		cw_system_prompt: [
			`开始分析前必须先调用 save_information_verification，参数为 ${buildGeneratingSaveParams()}；如果返回 skipped=true，必须立即停止，不要继续调用 skill 或生成正文。`,
			`必须触发并使用 ${INFORMATION_VERIFICATION_SKILL} skill 生成信息求证与置信度审计报告。`,
			`生成成功后必须调用 save_information_verification，参数为 ${buildFinalSaveParams("completed")}，content 传最终完整求证报告正文。`,
			`生成失败后必须调用 save_information_verification，参数为 ${buildFinalSaveParams("failed")}，content 存放完整错误信息。`
		].join("\n"),
		cw_context: JSON.stringify({
			sourceId: args.newsId,
			sourceTitle: args.sourceTitle
		}),
		cw_content: buildContent(args),
		cw_output: [
			`输出结构以 ${INFORMATION_VERIFICATION_SKILL} skill 的交付模板为准。`
		].join("\n")
	});
}

function selectGeneratingInformationVerification(userId: string, sourceId: string) {
	const db = getDB();
	return db.prepare(`
		SELECT id, sourceId, sourceTitle, status, content, createdAt, updatedAt
		FROM news_fact_check_analysis
		WHERE userId = ? AND sourceId = ? AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(userId, sourceId);
}

export const informationVerificationTools: Record<string, RuntimeTool> = {
	query_information_verification_history: {
		name: "query_information_verification_history",
		label: "查询信息求证列表",
		description: "分页查询信息求证记录列表。返回记录标识、来源 ID、标题、状态和时间字段；列表结果不包含 content，详情请使用 get_information_verification_detail 查询。",
		parameters: QueryInformationVerificationHistoryParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = QueryInformationVerificationHistoryParamsSchema.parse(params ?? {});
			const db = getDB();
			const offset = (args.page - 1) * args.pageSize;
			const rows = db.prepare(`
				SELECT id, sourceId, sourceTitle, status, createdAt, updatedAt
				FROM news_fact_check_analysis
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT ? OFFSET ?
			`).all(args.pageSize, offset);
			const countRow = db.prepare(`
				SELECT COUNT(*) AS total FROM news_fact_check_analysis
			`).get() as { total: number };
			const total = countRow.total || 0;
			return JSON.stringify({
				success: true,
				data: rows,
				pagination: {
					page: args.page,
					pageSize: args.pageSize,
					total,
					totalPages: Math.ceil(total / args.pageSize)
				}
			});
		}
	},
	get_information_verification_detail: {
		name: "get_information_verification_detail",
		label: "查询信息求证详情",
		description: "根据记录 ID 或 sourceId 查询信息求证完整详情，包含 content 正文及所有元数据。",
		parameters: GetInformationVerificationDetailParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetInformationVerificationDetailParamsSchema.parse(params);
			const db = getDB();
			if (args.sourceId) {
				const row = db.prepare(`
					SELECT id, sourceId, sourceTitle, status, content, createdAt, updatedAt
					FROM news_fact_check_analysis
					WHERE sourceId = ?
					ORDER BY updatedAt DESC, createdAt DESC
					LIMIT 1
				`).get(args.sourceId);
				return JSON.stringify({ success: true, data: row || null });
			}
			const row = db.prepare(`
				SELECT id, sourceId, sourceTitle, status, content, createdAt, updatedAt
				FROM news_fact_check_analysis
				WHERE id = ?
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT 1
			`).get(args.id);
			return JSON.stringify({ success: true, data: row || null });
		}
	},
	build_information_verification_message: {
		name: "build_information_verification_message",
		label: "构建信息求证消息",
		description: "根据新闻 ID、标题和正文构建用于主动 RPC 发起 Agent 信息求证任务的标准消息。该工具只返回提示词消息体，不触发定时任务，也不保存分析结果。",
		parameters: BuildInformationVerificationMessageAgentToolSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = BuildInformationVerificationMessageParamsSchema.parse(params);
			const userId = ctx?.userId || "default";
			const generating = selectGeneratingInformationVerification(userId, args.newsId);
			if (generating) {
				return JSON.stringify({
					success: true,
					skipped: true,
					reason: "already_generating",
					data: generating
				});
			}
			const message = buildInformationVerificationMessage(args);
			return JSON.stringify({
				success: true,
				data: {
					message,
					payload: JSON.parse(message),
					sourceId: args.newsId,
					saveParams: {
						sourceId: args.newsId,
						sourceTitle: args.sourceTitle
					},
					skill: INFORMATION_VERIFICATION_SKILL
				}
			});
		}
	}
};
