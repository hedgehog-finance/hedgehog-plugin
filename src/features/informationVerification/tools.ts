import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import {
	BuildInformationVerificationMessageParams,
	BuildInformationVerificationMessageParamsSchema,
	GetInformationVerificationDetailBySessionParamsSchema,
	GetInformationVerificationDetailParamsSchema,
	QueryInformationVerificationHistoryParamsSchema,
	SaveInformationVerificationParamsSchema
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
		sourceContent: { type: "string", description: "新闻正文" },
		sessionId: { type: "string", description: "前端生成的会话 ID" }
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
	const sessionId = args.sessionId || "";
	const buildGeneratingSaveParams = () => JSON.stringify({
		sourceId: args.newsId,
		sourceTitle: args.sourceTitle,
		sessionId,
		status: "generating",
		content: ""
	});
	const buildFinalSaveParams = (status: "completed" | "failed") => JSON.stringify({
		sourceId: args.newsId,
		sessionId,
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
			sourceTitle: args.sourceTitle,
			sessionId
		}),
		cw_content: buildContent(args),
		cw_output: [
			`输出结构以 ${INFORMATION_VERIFICATION_SKILL} skill 的交付模板为准。`
		].join("\n")
	});
}

function selectGeneratingInformationVerification(sourceId: string, sessionId?: string) {
	const db = getDB();
	const normalizedSessionId = sessionId?.trim() || "";
	if (normalizedSessionId) {
		const bySession = db.prepare(`
			SELECT id, sourceId, sourceTitle, sessionId, status, content, createdAt, updatedAt
			FROM news_fact_check_analysis
			WHERE sourceId = ? AND sessionId = ? AND status = 'generating'
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(sourceId, normalizedSessionId);
		if (bySession) return bySession;
	}

	return db.prepare(`
		SELECT id, sourceId, sourceTitle, sessionId, status, content, createdAt, updatedAt
		FROM news_fact_check_analysis
		WHERE sourceId = ? AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(sourceId);
}

function selectInformationVerificationForUpdate(sourceId: string, sessionId: string) {
	const db = getDB();
	if (sessionId) {
		const bySession = db.prepare(`
			SELECT id, sourceId, sourceTitle, sessionId, status, content, createdAt, updatedAt
			FROM news_fact_check_analysis
			WHERE sourceId = ? AND sessionId = ?
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(sourceId, sessionId);
		if (bySession) return bySession as { id: string; sourceTitle: string };
	}

	const generating = selectGeneratingInformationVerification(sourceId) as { id: string; sourceTitle: string } | undefined;
	if (generating) return generating;

	return db.prepare(`
		SELECT id, sourceId, sourceTitle, sessionId, status, content, createdAt, updatedAt
		FROM news_fact_check_analysis
		WHERE sourceId = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(sourceId) as { id: string; sourceTitle: string } | undefined;
}

function saveInformationVerificationRecord(
	userId: string,
	args: {
		sourceId: string;
		sourceTitle: string;
		sessionId?: string;
		content: string;
		status: string;
	}
) {
	const db = getDB();
	const id = randomUUID();
	const sessionId = args.sessionId?.trim() || "";
	const existing = selectInformationVerificationForUpdate(args.sourceId, sessionId);

	if (existing) {
		const sourceTitle = args.sourceTitle.trim() || existing.sourceTitle || "";
		db.prepare(`
			UPDATE news_fact_check_analysis
			SET sourceTitle = ?,
				sessionId = CASE WHEN ? != '' THEN ? ELSE sessionId END,
				status = ?,
				content = ?,
				updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
			WHERE id = ?
		`).run(sourceTitle, sessionId, sessionId, args.status, args.content, existing.id);

		return db.prepare(`
			SELECT id, sourceId, 'verification' AS analysisType, sourceTitle, sessionId, status, content, createdAt, updatedAt
			FROM news_fact_check_analysis
			WHERE id = ?
		`).get(existing.id);
	}

	db.prepare(`
		INSERT INTO news_fact_check_analysis (id, sourceId, sourceTitle, userId, sessionId, status, content)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`).run(id, args.sourceId, args.sourceTitle, userId, sessionId, args.status, args.content);

	return db.prepare(`
		SELECT id, sourceId, 'verification' AS analysisType, sourceTitle, sessionId, status, content, createdAt, updatedAt
		FROM news_fact_check_analysis
		WHERE id = ?
	`).get(id);
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
				SELECT id, sourceId, sourceTitle, sessionId, status, createdAt, updatedAt
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
					SELECT id, sourceId, sourceTitle, sessionId, status, content, createdAt, updatedAt
					FROM news_fact_check_analysis
					WHERE sourceId = ?
					ORDER BY updatedAt DESC, createdAt DESC
					LIMIT 1
				`).get(args.sourceId);
				return JSON.stringify({ success: true, data: row || null });
			}
			const row = db.prepare(`
				SELECT id, sourceId, sourceTitle, sessionId, status, content, createdAt, updatedAt
				FROM news_fact_check_analysis
				WHERE id = ?
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT 1
			`).get(args.id);
			return JSON.stringify({ success: true, data: row || null });
		}
	},
	get_information_verification_detail_by_session: {
		name: "get_information_verification_detail_by_session",
		label: "按会话查询信息求证详情",
		description: "根据 sessionId 和 sourceId 查询信息求证详情元数据；不返回 content 正文。",
		parameters: GetInformationVerificationDetailBySessionParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetInformationVerificationDetailBySessionParamsSchema.parse(params);
			const db = getDB();
			const row = db.prepare(`
				SELECT id, sourceId, sourceTitle, sessionId, status, createdAt, updatedAt
				FROM news_fact_check_analysis
				WHERE sessionId = ? AND sourceId = ?
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT 1
			`).get(args.sessionId, args.sourceId);
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
			const generating = selectGeneratingInformationVerification(args.newsId, args.sessionId);
			if (generating) {
				return JSON.stringify({
					success: true,
					skipped: true,
					reason: "already_generating",
					data: generating
				});
			}
			const message = buildInformationVerificationMessage(args);
			const payload = JSON.parse(message);
			return JSON.stringify({
				success: true,
				data: {
					message,
					payload,
					sourceId: args.newsId,
					saveParams: {
						sourceId: args.newsId,
						sourceTitle: args.sourceTitle,
						sessionId: args.sessionId || ""
					},
					skill: INFORMATION_VERIFICATION_SKILL
				}
			});
		}
	},
	save_information_verification: {
		name: "save_information_verification",
		description: "保存新闻信息求证结果。生成前必须先以 status=generating、content=\"\" 调用，并传入 sourceId、sourceTitle；生成成功后以 status=completed 保存完整正文 content；生成失败后以 status=failed 保存完整错误信息。",
		parameters: SaveInformationVerificationParamsSchema,
		registerTool: true,
		async execute(params, ctx) {
			const args = SaveInformationVerificationParamsSchema.parse(params);
			const userId = ctx?.userId || "default";
			if (args.status === "generating") {
				const generating = selectGeneratingInformationVerification(args.sourceId, args.sessionId);
				if (generating) {
					return JSON.stringify({ success: true, skipped: true, reason: "already_generating", data: generating });
				}
			}
			const data = saveInformationVerificationRecord(userId, args);
			return JSON.stringify({ success: true, data });
		}
	}
};
