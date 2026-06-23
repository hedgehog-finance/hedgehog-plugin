import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import { BuildInformationVerificationMessageAgentToolSchema, BuildInformationVerificationMessageParamsSchema, GetInformationVerificationDetailBySessionParamsSchema, GetInformationVerificationDetailParamsSchema, QueryInformationVerificationHistoryParamsSchema } from "./schema.js";
const INFORMATION_VERIFICATION_SKILL = "hedgehog-information-verification";
function buildContent(args) {
    const content = [
        "对这条新闻进行信息求证",
        "",
        `新闻标题：${args.sourceTitle}`,
    ];
    if (args.publishTime) {
        content.push(`发布时间：${args.publishTime}`);
    }
    content.push("", "新闻正文：", args.sourceContent);
    return content.join("\n");
}
function buildInformationVerificationMessage(args) {
    const sessionId = args.sessionId || "";
    return JSON.stringify({
        cw_system_prompt: [
            `第 1 步：必须触发并使用 ${INFORMATION_VERIFICATION_SKILL} skill 生成信息求证与置信度审计报告。`,
            `第 2 步：生成成功后必须调用 save_task_output，参数为 {"sessionId":"${sessionId}","saveStrategy":"overwrite","output":"...","status":"completed"}，output 必须原样传入 skill 生成的最终完整求证报告全文，禁止摘要、改写、删减、重排或重新组织。`,
            `失败处理：生成失败后必须调用 save_task_output，参数为 {"sessionId":"${sessionId}","saveStrategy":"overwrite","output":"...","status":"failed"}，output 存放完整错误信息。`
        ].join("\n"),
        cw_content: buildContent(args),
        cw_output: [
            `输出结构以 ${INFORMATION_VERIFICATION_SKILL} skill 的交付模板为准。`,
            '强制启用“本地缓存任务日志”'
        ].join("\n")
    });
}
function mapRowToFactCheck(row) {
    const ref = JSON.parse(row.reference || "{}");
    return {
        id: row.id,
        sourceId: ref.sourceId || "",
        sourceTitle: ref.sourceTitle || "",
        sessionId: row.id,
        status: row.status,
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function selectGeneratingInformationVerification(sourceId, sessionId) {
    const db = getDB();
    const normalizedSessionId = sessionId?.trim() || "";
    if (normalizedSessionId) {
        const bySession = db.prepare(`
			SELECT id, reference, status, content, created_at, updated_at
			FROM agent_sessions
			WHERE biz_type = 'fact_check'
				AND json_extract(reference, '$.sourceId') = ?
				AND id = ?
				AND status = 'generating'
			ORDER BY updated_at DESC, created_at DESC
			LIMIT 1
		`).get(sourceId, normalizedSessionId);
        if (bySession)
            return mapRowToFactCheck(bySession);
    }
    const row = db.prepare(`
		SELECT id, reference, status, content, created_at, updated_at
		FROM agent_sessions
		WHERE biz_type = 'fact_check'
			AND json_extract(reference, '$.sourceId') = ?
			AND status = 'generating'
		ORDER BY updated_at DESC, created_at DESC
		LIMIT 1
	`).get(sourceId);
    return row ? mapRowToFactCheck(row) : undefined;
}
function createGeneratingInformationVerification(args) {
    const db = getDB();
    const { sourceId, sourceTitle, sessionId } = args;
    const workId = `work_${sessionId}`;
    const taskId = `task_${sessionId}`;
    const refObj = {
        sourceId: sourceId,
        sourceTitle: sourceTitle.trim()
    };
    db.prepare(`
		INSERT OR IGNORE INTO works (id, name, description, status, orchestrator_type)
		VALUES (?, ?, '信息求证工作流', 'running', 'hard')
	`).run(workId, `信息求证工作流 (${sourceTitle.trim()})`);
    db.prepare(`
		INSERT OR IGNORE INTO tasks (id, work_id, name, status, agent_session_id, content)
		VALUES (?, ?, '执行信息求证', 'running', ?, '')
	`).run(taskId, workId, sessionId);
    db.prepare(`
		INSERT OR IGNORE INTO agent_sessions (id, session_name, biz_type, status, reference, content, work_id, task_id)
		VALUES (?, ?, 'fact_check', 'generating', ?, '', ?, ?)
	`).run(sessionId, `信息求证 (${sourceTitle.trim()})`, JSON.stringify(refObj), workId, taskId);
    const inserted = db.prepare(`
		SELECT id, reference, status, content, created_at, updated_at
		FROM agent_sessions
		WHERE id = ?
	`).get(sessionId);
    return { ...mapRowToFactCheck(inserted), analysisType: "verification" };
}
export const informationVerificationTools = {
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
				SELECT id, reference, status, created_at, updated_at
				FROM agent_sessions
				WHERE biz_type = 'fact_check'
				ORDER BY updated_at DESC, created_at DESC
				LIMIT ? OFFSET ?
			`).all(args.pageSize, offset);
            const countRow = db.prepare(`
				SELECT COUNT(*) AS total FROM agent_sessions WHERE biz_type = 'fact_check'
			`).get();
            const total = countRow.total || 0;
            const data = rows.map(r => mapRowToFactCheck(r));
            return JSON.stringify({
                success: true,
                data,
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
					SELECT id, reference, status, content, created_at, updated_at
					FROM agent_sessions
					WHERE biz_type = 'fact_check' AND json_extract(reference, '$.sourceId') = ?
					ORDER BY updated_at DESC, created_at DESC
					LIMIT 1
				`).get(args.sourceId);
                return JSON.stringify({ success: true, data: row ? mapRowToFactCheck(row) : null });
            }
            const row = db.prepare(`
				SELECT id, reference, status, content, created_at, updated_at
				FROM agent_sessions
				WHERE id = ? AND biz_type = 'fact_check'
			`).get(args.id);
            return JSON.stringify({ success: true, data: row ? mapRowToFactCheck(row) : null });
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
				SELECT id, reference, status, created_at, updated_at
				FROM agent_sessions
				WHERE id = ? AND biz_type = 'fact_check' AND json_extract(reference, '$.sourceId') = ?
				ORDER BY updated_at DESC, created_at DESC
				LIMIT 1
			`).get(args.sessionId, args.sourceId);
            return JSON.stringify({ success: true, data: row ? mapRowToFactCheck(row) : null });
        }
    },
    build_information_verification_message: {
        name: "build_information_verification_message",
        label: "构建信息求证消息",
        description: "发起信息求证任务，返回 Agent 消息。",
        parameters: BuildInformationVerificationMessageAgentToolSchema,
        registerTool: false,
        async execute(params) {
            const args = BuildInformationVerificationMessageParamsSchema.parse(params);
            const sessionId = args.sessionId?.trim() || randomUUID();
            const generating = selectGeneratingInformationVerification(args.newsId, sessionId);
            if (generating) {
                return JSON.stringify({
                    success: true,
                    skipped: true,
                    data: {
                        status: generating.status
                    }
                });
            }
            const preflightSave = createGeneratingInformationVerification({
                sourceId: args.newsId,
                sourceTitle: args.sourceTitle,
                sessionId: sessionId
            });
            const message = buildInformationVerificationMessage({ ...args, sessionId });
            return JSON.stringify({
                success: true,
                data: {
                    status: preflightSave.status,
                    message
                }
            });
        }
    }
};
//# sourceMappingURL=tools.js.map