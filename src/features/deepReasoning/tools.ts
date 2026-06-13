import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import {
	BuildDeepReasoningMessageParams,
	BuildDeepReasoningMessageParamsSchema,
	GetDeepReasoningDetailBySessionParamsSchema,
	GetDeepReasoningDetailParamsSchema,
	QueryDeepReasoningHistoryParamsSchema,
	SaveDeepReasoningParamsSchema
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
		sourceContent: { type: "string", description: "新闻正文" },
		sessionId: { type: "string", description: "前端生成的会话 ID" }
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
			`开始分析前必须先调用 save_article_deep_reasoning_analysis，参数为 ${buildGeneratingSaveParams()}；如果返回 skipped=true，必须立即停止，不要继续调用 skill 或生成正文。`,
			"仅允许按上述标准参数调用 save_article_deep_reasoning_analysis；如果无法提供标准参数，或参数包含标准参数以外的字段，不要调用 save_article_deep_reasoning_analysis。",
			`必须触发并使用 ${DEEP_REASONING_SKILL} skill 生成新闻事件深度推演报告。`,
			`生成成功后必须调用 save_article_deep_reasoning_analysis，参数为 ${buildFinalSaveParams("completed")}，content 传最终完整深度推演报告正文。`,
			`生成失败后必须调用 save_article_deep_reasoning_analysis，参数为 ${buildFinalSaveParams("failed")}，content 存放完整错误信息。`
		].join("\n"),
		cw_context: JSON.stringify({
			sourceId: args.newsId,
			sourceTitle: args.sourceTitle,
			sessionId
		}),
		cw_content: buildContent(args),
		cw_output: [
			`输出结构以 ${DEEP_REASONING_SKILL} skill 的交付模板为准。`,
			'强制启用“本地缓存任务日志”'
		].join("\n")
	});
}

function selectGeneratingDeepReasoning(sourceId: string, market: string, sessionId?: string) {
	const db = getDB();
	const normalizedSessionId = sessionId?.trim() || "";
	if (normalizedSessionId) {
		const bySession = db.prepare(`
			SELECT id, sourceId, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
			FROM news_deep_reasoning_analysis
			WHERE sourceId = ? AND market = ? AND sessionId = ? AND status = 'generating'
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(sourceId, market, normalizedSessionId);
		if (bySession) return bySession;
	}

	return db.prepare(`
		SELECT id, sourceId, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
		FROM news_deep_reasoning_analysis
		WHERE sourceId = ? AND market = ? AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(sourceId, market);
}

function selectDeepReasoningForUpdate(sourceId: string, market: string, sessionId: string) {
	const db = getDB();
	if (sessionId) {
		const bySession = db.prepare(`
			SELECT id, sourceId, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
			FROM news_deep_reasoning_analysis
			WHERE sourceId = ? AND market = ? AND sessionId = ?
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(sourceId, market, sessionId);
		if (bySession) return bySession as { id: string; sourceTitle: string };
	}

	const generating = selectGeneratingDeepReasoning(sourceId, market) as { id: string; sourceTitle: string } | undefined;
	if (generating) return generating;

	return db.prepare(`
		SELECT id, sourceId, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
		FROM news_deep_reasoning_analysis
		WHERE sourceId = ? AND market = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(sourceId, market) as { id: string; sourceTitle: string } | undefined;
}

function saveDeepReasoningRecord(
	userId: string,
	args: {
		sourceId: string;
		sourceTitle: string;
		market: string;
		sessionId?: string;
		content: string;
		status: string;
	}
) {
	const db = getDB();
	const id = randomUUID();
	const sessionId = args.sessionId?.trim() || "";
	const existing = selectDeepReasoningForUpdate(args.sourceId, args.market, sessionId);

	if (existing) {
		const sourceTitle = args.sourceTitle.trim() || existing.sourceTitle || "";
		db.prepare(`
			UPDATE news_deep_reasoning_analysis
			SET sourceTitle = ?,
				sessionId = CASE WHEN ? != '' THEN ? ELSE sessionId END,
				status = ?,
				content = ?,
				updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
			WHERE id = ?
		`).run(sourceTitle, sessionId, sessionId, args.status, args.content, existing.id);

		return db.prepare(`
			SELECT id, sourceId, 'deduction' AS analysisType, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
			FROM news_deep_reasoning_analysis
			WHERE id = ?
		`).get(existing.id);
	}

	db.prepare(`
		INSERT INTO news_deep_reasoning_analysis (id, sourceId, sourceTitle, userId, market, sessionId, status, content)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`).run(id, args.sourceId, args.sourceTitle, userId, args.market, sessionId, args.status, args.content);

	return db.prepare(`
		SELECT id, sourceId, 'deduction' AS analysisType, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
		FROM news_deep_reasoning_analysis
		WHERE id = ?
	`).get(id);
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
				SELECT id, sourceId, sourceTitle, sessionId, status, createdAt, updatedAt
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
					SELECT id, sourceId, sourceTitle, sessionId, status, content, createdAt, updatedAt
					FROM news_deep_reasoning_analysis
					WHERE sourceId = ?
					ORDER BY updatedAt DESC, createdAt DESC
					LIMIT 1
				`).get(args.sourceId);
				return JSON.stringify({ success: true, data: row || null });
			}
			const row = db.prepare(`
				SELECT id, sourceId, sourceTitle, sessionId, status, content, createdAt, updatedAt
				FROM news_deep_reasoning_analysis
				WHERE id = ?
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT 1
			`).get(args.id);
			return JSON.stringify({ success: true, data: row || null });
		}
	},
	get_deep_reasoning_detail_by_session: {
		name: "get_deep_reasoning_detail_by_session",
		label: "按会话查询深度推演详情",
		description: "根据 sessionId 和 sourceId 查询深度推演详情元数据；不返回 content 正文。",
		parameters: GetDeepReasoningDetailBySessionParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetDeepReasoningDetailBySessionParamsSchema.parse(params);
			const db = getDB();
			const row = db.prepare(`
				SELECT id, sourceId, sourceTitle, market, sessionId, status, createdAt, updatedAt
				FROM news_deep_reasoning_analysis
				WHERE sessionId = ? AND sourceId = ?
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT 1
			`).get(args.sessionId, args.sourceId);
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
			const generating = selectGeneratingDeepReasoning(args.newsId, "CN", args.sessionId);
			if (generating) {
				return JSON.stringify({
					success: true,
					skipped: true,
					reason: "already_generating",
					data: generating
				});
			}
			const message = buildDeepReasoningMessage(args);
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
					skill: DEEP_REASONING_SKILL
				}
			});
		}
	},
	save_article_deep_reasoning_analysis: {
		name: "save_article_deep_reasoning_analysis",
		description: "保存新闻深度推演结果。生成前必须先以 status=generating、content=\"\" 调用，并传入 sourceId、sourceTitle、sourceContent、market；生成成功后以 status=completed 保存完整正文 content；生成失败后以 status=failed 保存完整错误信息。",
		parameters: SaveDeepReasoningParamsSchema,
		registerTool: true,
		async execute(params, ctx) {
			const args = SaveDeepReasoningParamsSchema.parse(params);
			const userId = ctx?.userId || "default";
			if (args.status === "generating") {
				const generating = selectGeneratingDeepReasoning(args.sourceId, args.market, args.sessionId);
				if (generating) {
					return JSON.stringify({ success: true, skipped: true, reason: "already_generating", data: generating });
				}
			}
			const data = saveDeepReasoningRecord(userId, args);
			return JSON.stringify({ success: true, data });
		}
	}
};
