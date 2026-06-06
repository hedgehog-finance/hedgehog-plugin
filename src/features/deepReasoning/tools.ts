import { getDB } from "../../core/database.js";
import {
	BuildDeepReasoningMessageParams,
	BuildDeepReasoningMessageParamsSchema,
	GetDeepReasoningDetailParamsSchema,
	QueryDeepReasoningHistoryParamsSchema
} from "./schema.js";

interface RuntimeTool {
	name: string;
	label?: string;
	description: string;
	parameters: unknown;
	registerTool?: boolean;
	execute(params: unknown, ctx?: { userId: string }): Promise<string>;
}

const DEEP_REASONING_SKILL = "hedgehog-news-deep-reasoning";

const BuildDeepReasoningMessageAgentToolSchema = {
	type: "object",
	additionalProperties: false,
	required: ["newsId", "sourceTitle", "sourceContent"],
	properties: {
		newsId: { type: "string", description: "新闻 ID，例如 news-5" },
		sourceTitle: { type: "string", description: "新闻标题" },
		sourceContent: { type: "string", description: "新闻正文" }
	}
};

function buildContent(args: BuildDeepReasoningMessageParams): string {
	return [
		"对这条新闻进行深度推演",
		"",
		`新闻标题：${args.sourceTitle}`,
		"",
		"新闻正文：",
		args.sourceContent
	].join("\n");
}

function buildDeepReasoningMessage(args: BuildDeepReasoningMessageParams): string {
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
			`开始分析前必须先调用 save_article_deep_reasoning_analysis，参数为 ${buildGeneratingSaveParams()}；如果返回 skipped=true，必须立即停止，不要继续调用 skill 或生成正文。`,
			"仅允许按上述标准参数调用 save_article_deep_reasoning_analysis；如果无法提供标准参数，或参数包含标准参数以外的字段，不要调用 save_article_deep_reasoning_analysis。",
			`必须触发并使用 ${DEEP_REASONING_SKILL} skill 生成新闻事件深度推演报告。`,
			`生成成功后必须调用 save_article_deep_reasoning_analysis，参数为 ${buildFinalSaveParams("completed")}，content 传最终完整深度推演报告正文。`,
			`生成失败后必须调用 save_article_deep_reasoning_analysis，参数为 ${buildFinalSaveParams("failed")}，content 存放完整错误信息。`
		].join("\n"),
		cw_context: JSON.stringify({
			sourceId: args.newsId,
			sourceTitle: args.sourceTitle
		}),
		cw_content: buildContent(args),
		cw_output: [
			`输出结构以 ${DEEP_REASONING_SKILL} skill 的交付模板为准。`
		].join("\n")
	});
}

function selectGeneratingDeepReasoning(userId: string, sourceId: string) {
	const db = getDB();
	return db.prepare(`
		SELECT id, sourceId, sourceTitle, status, content, createdAt, updatedAt
		FROM news_deep_reasoning_analysis
		WHERE userId = ? AND sourceId = ? AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(userId, sourceId);
}

export const deepReasoningTools: Record<string, RuntimeTool> = {
	query_deep_reasoning_history: {
		name: "query_deep_reasoning_history",
		label: "查询深度推演列表",
		description: "分页查询深度推演记录列表。返回记录标识、来源 ID、标题、状态和时间字段；列表结果不包含 content，详情请使用 get_deep_reasoning_detail 查询。",
		parameters: QueryDeepReasoningHistoryParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = QueryDeepReasoningHistoryParamsSchema.parse(params ?? {});
			const db = getDB();
			const offset = (args.page - 1) * args.pageSize;
			const rows = db.prepare(`
				SELECT id, sourceId, sourceTitle, status, createdAt, updatedAt
				FROM news_deep_reasoning_analysis
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT ? OFFSET ?
			`).all(args.pageSize, offset);
			const countRow = db.prepare(`
				SELECT COUNT(*) AS total FROM news_deep_reasoning_analysis
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
	get_deep_reasoning_detail: {
		name: "get_deep_reasoning_detail",
		label: "查询深度推演详情",
		description: "根据记录 ID 或 sourceId 查询深度推演完整详情，包含 content 正文及所有元数据。",
		parameters: GetDeepReasoningDetailParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetDeepReasoningDetailParamsSchema.parse(params);
			const db = getDB();
			if (args.sourceId) {
				const row = db.prepare(`
					SELECT id, sourceId, sourceTitle, status, content, createdAt, updatedAt
					FROM news_deep_reasoning_analysis
					WHERE sourceId = ?
					ORDER BY updatedAt DESC, createdAt DESC
					LIMIT 1
				`).get(args.sourceId);
				return JSON.stringify({ success: true, data: row || null });
			}
			const row = db.prepare(`
				SELECT id, sourceId, sourceTitle, status, content, createdAt, updatedAt
				FROM news_deep_reasoning_analysis
				WHERE id = ?
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT 1
			`).get(args.id);
			return JSON.stringify({ success: true, data: row || null });
		}
	},
	build_deep_reasoning_message: {
		name: "build_deep_reasoning_message",
		label: "构建深度推演消息",
		description: "根据新闻 ID、标题和正文构建用于主动 RPC 发起 Agent 新闻深度推演任务的标准消息。该工具只返回提示词消息体，不触发定时任务，也不保存分析结果。",
		parameters: BuildDeepReasoningMessageAgentToolSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = BuildDeepReasoningMessageParamsSchema.parse(params);
			const userId = ctx?.userId || "default";
			const generating = selectGeneratingDeepReasoning(userId, args.newsId);
			if (generating) {
				return JSON.stringify({
					success: true,
					skipped: true,
					reason: "already_generating",
					data: generating
				});
			}
			const message = buildDeepReasoningMessage(args);
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
					skill: DEEP_REASONING_SKILL
				}
			});
		}
	}
};
