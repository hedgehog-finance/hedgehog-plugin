import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import { BuildDeepReasoningMessageAgentToolSchema, BuildDeepReasoningMessageParamsSchema, GetDeepReasoningDetailBySessionParamsSchema, GetDeepReasoningDetailParamsSchema, QueryDeepReasoningHistoryParamsSchema, SaveDeepReasoningAgentToolSchema, SaveDeepReasoningParamsSchema } from "./schema.js";
const DEEP_REASONING_SKILL = "hedgehog-in-depth-analysis";
function buildContent(args) {
    return [
        "对这条新闻进行深度推演",
        "",
        `新闻标题：${args.sourceTitle}`,
        "",
        "新闻正文：",
        args.sourceContent
    ].join("\n");
}
function buildDeepReasoningMessage(args) {
    const sessionId = args.sessionId || "";
    const buildFinalSaveParams = (status) => JSON.stringify({
        sourceId: args.newsId,
        sessionId,
        status,
        content: "..."
    });
    return JSON.stringify({
        cw_system_prompt: [
            `第 1 步：必须触发并使用 ${DEEP_REASONING_SKILL} skill 生成新闻事件深度推演报告。`,
            `第 2 步：生成成功后必须调用 save_article_deep_reasoning_analysis，参数为 ${buildFinalSaveParams("completed")}，content 必须原样传入 skill 生成的最终完整深度推演报告全文，禁止摘要、改写、删减、重排或重新组织。`,
            `失败处理：生成失败后必须调用 save_article_deep_reasoning_analysis，参数为 ${buildFinalSaveParams("failed")}，content 存放完整错误信息。`
        ].join("\n"),
        cw_content: buildContent(args),
        cw_output: [
            `输出结构以 ${DEEP_REASONING_SKILL} skill 的交付模板为准。`,
            '强制启用“本地缓存任务日志”'
        ].join("\n")
    });
}
function selectGeneratingDeepReasoning(sourceId, market, sessionId) {
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
        if (bySession)
            return bySession;
    }
    return db.prepare(`
		SELECT id, sourceId, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
		FROM news_deep_reasoning_analysis
		WHERE sourceId = ? AND market = ? AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(sourceId, market);
}
function selectDeepReasoningForUpdate(sourceId, market, sessionId) {
    const db = getDB();
    if (sessionId) {
        const bySession = db.prepare(`
			SELECT id, sourceId, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
			FROM news_deep_reasoning_analysis
			WHERE sourceId = ? AND market = ? AND sessionId = ?
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(sourceId, market, sessionId);
        if (bySession)
            return bySession;
    }
    const generating = selectGeneratingDeepReasoning(sourceId, market);
    if (generating)
        return generating;
    return db.prepare(`
		SELECT id, sourceId, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
		FROM news_deep_reasoning_analysis
		WHERE sourceId = ? AND market = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(sourceId, market);
}
function saveDeepReasoningRecord(args) {
    const db = getDB();
    const id = randomUUID();
    const sessionId = args.sessionId?.trim() || "";
    const existing = args.status === "generating"
        ? undefined
        : selectDeepReasoningForUpdate(args.sourceId, args.market, sessionId);
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
	`).run(id, args.sourceId, args.sourceTitle, "default", args.market, sessionId, args.status, args.content);
    return db.prepare(`
		SELECT id, sourceId, 'deduction' AS analysisType, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
		FROM news_deep_reasoning_analysis
		WHERE id = ?
	`).get(id);
}
export const deepReasoningTools = {
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
			`).get();
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
        description: "发起深度推演任务，返回 Agent 消息。",
        parameters: BuildDeepReasoningMessageAgentToolSchema,
        registerTool: false,
        async execute(params) {
            const args = BuildDeepReasoningMessageParamsSchema.parse(params);
            const generating = selectGeneratingDeepReasoning(args.newsId, "CN", args.sessionId);
            if (generating) {
                return JSON.stringify({
                    success: true,
                    skipped: true,
                    data: {
                        status: generating.status
                    }
                });
            }
            const preflightSave = saveDeepReasoningRecord({
                sourceId: args.newsId,
                sourceTitle: args.sourceTitle,
                market: "CN",
                sessionId: args.sessionId || "",
                status: "generating",
                content: ""
            });
            const message = buildDeepReasoningMessage(args);
            return JSON.stringify({
                success: true,
                data: {
                    status: preflightSave.status,
                    message
                }
            });
        }
    },
    save_article_deep_reasoning_analysis: {
        name: "save_article_deep_reasoning_analysis",
        description: "保存新闻深度推演结果。任务派发工具通常已预先保存 status=generating；Agent 生成成功后以 status=completed 保存完整正文 content，生成失败后以 status=failed 保存完整错误信息。status=generating 仅用于兼容直接预占位调用。",
        parameters: SaveDeepReasoningAgentToolSchema,
        registerTool: true,
        async execute(params) {
            const args = SaveDeepReasoningParamsSchema.parse(params);
            if (args.status === "generating") {
                const generating = selectGeneratingDeepReasoning(args.sourceId, args.market, args.sessionId);
                if (generating) {
                    return JSON.stringify({ success: true, skipped: true, reason: "already_generating", data: generating });
                }
            }
            const data = saveDeepReasoningRecord(args);
            return JSON.stringify({ success: true, data });
        }
    }
};
//# sourceMappingURL=tools.js.map