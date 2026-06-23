import { getDB } from "../../core/database.js";
import { GetTasksOutputParamsSchema, QueryTasksOutputParamsSchema, SaveTasksOutputParamsSchema } from "./schema.js";
const SAVE_TASKS_OUTPUT_USAGE = [
    "save_task_output 参数不正确。",
    "正确规则：只按 sessionId 保存；sessionId 必须是非空 string；saveStrategy 必须是 update 或 overwrite；output 必须是 string。",
    "saveStrategy=update 表示把 output 追加到已有输出末尾；saveStrategy=overwrite 表示新增记录或覆盖整个旧输出。",
    "可用示例：",
    '追加：{"sessionId":"session-001","saveStrategy":"update","output":"完整的输出内容"}',
    '覆盖：{"sessionId":"session-001","saveStrategy":"overwrite","output":"完整的输出内容"}'
].join("\n");
function optionalString(value, field) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string") {
        throw new Error(`${field} must be a string`);
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
function parsePositiveInteger(value, fallback, max) {
    if (value === undefined)
        return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new Error("page and pageSize must be positive integers");
    }
    if (max && value > max) {
        throw new Error(`pageSize must be less than or equal to ${max}`);
    }
    return value;
}
function requireSaveString(value, field) {
    if (typeof value !== "string") {
        throw new Error(`${SAVE_TASKS_OUTPUT_USAGE}\n当前错误：${field} 必须是 string。`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`${SAVE_TASKS_OUTPUT_USAGE}\n当前错误：${field} 不能是空字符串。`);
    }
    return trimmed;
}
function parseSaveTasksOutputParams(params) {
    const raw = (params || {});
    if (typeof raw.output !== "string") {
        throw new Error(`${SAVE_TASKS_OUTPUT_USAGE}\n当前错误：output 必须存在且类型必须是 string。`);
    }
    if (raw.saveStrategy !== "update" && raw.saveStrategy !== "overwrite") {
        throw new Error(`${SAVE_TASKS_OUTPUT_USAGE}\n当前错误：saveStrategy 必须是 "update" 或 "overwrite"。`);
    }
    const status = optionalString(raw.status, "status");
    const validStatuses = ["pending", "running", "paused", "completed", "failed", "cancelled", "skipped", "generating"];
    if (status && !validStatuses.includes(status)) {
        throw new Error(`status must be one of: ${validStatuses.join(", ")}`);
    }
    return {
        sessionId: requireSaveString(raw.sessionId, "sessionId"),
        saveStrategy: raw.saveStrategy,
        output: raw.output,
        status
    };
}
function parseGetTasksOutputParams(params) {
    const raw = (params || {});
    const sessionId = optionalString(raw.sessionId, "sessionId");
    if (!sessionId) {
        throw new Error("sessionId is required");
    }
    return { sessionId };
}
function parseQueryTasksOutputParams(params) {
    const raw = (params || {});
    return {
        taskId: optionalString(raw.taskId, "taskId"),
        workflowId: optionalString(raw.workflowId, "workflowId"),
        sessionId: optionalString(raw.sessionId, "sessionId"),
        page: parsePositiveInteger(raw.page, 1),
        pageSize: parsePositiveInteger(raw.pageSize, 20, 100)
    };
}
function selectTasksOutput(db, sessionId) {
    const row = db.prepare(`
		SELECT 
			task_id as taskId, 
			work_id as workflowId, 
			id as sessionId, 
			content as output, 
			created_at as createdAt, 
			updated_at as updatedAt
		FROM agent_sessions
		WHERE id = ?
	`).get(sessionId);
    if (!row)
        return null;
    return {
        taskId: row.taskId || "",
        workflowId: row.workflowId || "",
        sessionId: row.sessionId || "",
        output: row.output || "",
        createdAt: row.createdAt || "",
        updatedAt: row.updatedAt || ""
    };
}
function syncSessionAndWorkStatus(db, sessionId, status, content) {
    const session = db.prepare("SELECT id, work_id, task_id FROM agent_sessions WHERE id = ?").get(sessionId);
    if (session) {
        // 1. Map to agent_sessions.status (generating, scheduled, completed, failed, active)
        let sessionStatus = "generating";
        if (status === "completed") {
            sessionStatus = "completed";
        }
        else if (status === "failed" || status === "cancelled") {
            sessionStatus = "failed";
        }
        else if (status === "pending") {
            sessionStatus = "scheduled";
        }
        else if (status === "generating" || status === "running" || status === "paused") {
            sessionStatus = "generating";
        }
        else if (status === "skipped") {
            sessionStatus = "completed";
        }
        // 2. Map to works.status (pending, running, paused, completed, failed, cancelled)
        let workStatus = "running";
        if (status === "completed" || status === "skipped") {
            workStatus = "completed";
        }
        else if (status === "failed") {
            workStatus = "failed";
        }
        else if (status === "cancelled") {
            workStatus = "cancelled";
        }
        else if (status === "pending") {
            workStatus = "pending";
        }
        else if (status === "paused") {
            workStatus = "paused";
        }
        else if (status === "running" || status === "generating") {
            workStatus = "running";
        }
        // 3. Map to tasks.status (pending, running, completed, failed, skipped)
        let taskStatus = "running";
        if (status === "completed") {
            taskStatus = "completed";
        }
        else if (status === "failed" || status === "cancelled") {
            taskStatus = "failed";
        }
        else if (status === "skipped") {
            taskStatus = "skipped";
        }
        else if (status === "pending") {
            taskStatus = "pending";
        }
        else if (status === "running" || status === "generating" || status === "paused") {
            taskStatus = "running";
        }
        db.prepare(`
			UPDATE agent_sessions
			SET status = ?,
				content = ?,
				updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
			WHERE id = ?
		`).run(sessionStatus, content, sessionId);
        if (session.work_id && session.task_id) {
            db.prepare(`
				UPDATE tasks
				SET status = ?,
					content = ?,
					completed_at = CASE WHEN ? IN ('completed', 'failed', 'skipped') THEN STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') ELSE completed_at END,
					updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
				WHERE id = ?
			`).run(taskStatus, content, taskStatus, session.task_id);
            db.prepare(`
				UPDATE works
				SET status = ?,
					completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') ELSE completed_at END,
					updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
				WHERE id = ?
			`).run(workStatus, workStatus, session.work_id);
        }
    }
}
export const tasksOutputTools = {
    save_task_output: {
        name: "save_task_output",
        description: "按 sessionId 保存任务输出。saveStrategy=update 时追加 output；saveStrategy=overwrite 时新增或覆盖整个 output；保存后刷新 updatedAt。",
        parameters: SaveTasksOutputParamsSchema,
        registerTool: true,
        async execute(params) {
            const args = parseSaveTasksOutputParams(params);
            const db = getDB();
            const session = db.prepare("SELECT work_id, task_id, content FROM agent_sessions WHERE id = ?").get(args.sessionId);
            if (!session) {
                throw new Error(`找不到会话 ID: ${args.sessionId}`);
            }
            const finalOutput = args.saveStrategy === "update"
                ? (session.content || "") + args.output
                : args.output;
            const finalStatus = args.status || (args.saveStrategy === "update" ? "running" : "completed");
            syncSessionAndWorkStatus(db, args.sessionId, finalStatus, finalOutput);
            const saved = selectTasksOutput(db, args.sessionId);
            return JSON.stringify({
                success: true,
                message: args.saveStrategy === "update"
                    ? "任务输出已追加并完成持久化。"
                    : "任务输出已覆盖写入并完成持久化。",
                data: {
                    sessionId: args.sessionId,
                    saveStrategy: args.saveStrategy,
                    persisted: true,
                    writeStrategy: args.saveStrategy === "update" ? "append" : "overwrite",
                    totalOutputLength: saved?.output?.length || 0,
                    updatedAt: saved?.updatedAt || null
                }
            });
        }
    },
    get_task_output: {
        name: "get_task_output",
        description: "根据 sessionId 精确查询任务输出。",
        parameters: GetTasksOutputParamsSchema,
        registerTool: true,
        async execute(params) {
            const args = parseGetTasksOutputParams(params);
            const db = getDB();
            return JSON.stringify({
                success: true,
                data: selectTasksOutput(db, args.sessionId)
            });
        }
    },
    query_task_outputs: {
        name: "query_task_outputs",
        description: "分页查询任务输出，支持按 taskId、workflowId、sessionId 过滤。",
        parameters: QueryTasksOutputParamsSchema,
        registerTool: false,
        async execute(params) {
            const args = parseQueryTasksOutputParams(params);
            const db = getDB();
            const offset = (args.page - 1) * args.pageSize;
            const conditions = [];
            const queryParams = [];
            if (args.taskId) {
                conditions.push("task_id = ?");
                queryParams.push(args.taskId);
            }
            if (args.workflowId) {
                conditions.push("work_id = ?");
                queryParams.push(args.workflowId);
            }
            if (args.sessionId) {
                conditions.push("id = ?");
                queryParams.push(args.sessionId);
            }
            const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const rows = db.prepare(`
				SELECT 
					task_id as taskId, 
					work_id as workflowId, 
					id as sessionId, 
					content as output, 
					created_at as createdAt, 
					updated_at as updatedAt
				FROM agent_sessions
				${whereSql}
				ORDER BY updated_at DESC, created_at DESC
				LIMIT ? OFFSET ?
			`).all(...queryParams, args.pageSize, offset);
            const mappedRows = rows.map(r => ({
                taskId: r.taskId || "",
                workflowId: r.workflowId || "",
                sessionId: r.sessionId || "",
                output: r.output || "",
                createdAt: r.createdAt || "",
                updatedAt: r.updatedAt || ""
            }));
            const countRow = db.prepare(`
				SELECT COUNT(*) AS total
				FROM agent_sessions
				${whereSql}
			`).get(...queryParams);
            const total = countRow.total || 0;
            return JSON.stringify({
                success: true,
                data: mappedRows,
                pagination: {
                    page: args.page,
                    pageSize: args.pageSize,
                    total,
                    totalPages: Math.ceil(total / args.pageSize)
                }
            });
        }
    }
};
//# sourceMappingURL=tools.js.map