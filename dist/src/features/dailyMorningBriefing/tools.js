import { getDB } from "../../core/database.js";
import { scheduleDailyMorningBriefingTurnCron } from "../../dailyMorningBriefingCron.js";
import { HEDGEHOG_AGENT_ID } from "../../openclawConstants.js";
import { CHART_OUTPUT_GUIDANCE } from "../chartOutput.js";
import { BuildDailyMorningBriefingMessageAgentToolSchema, BuildDailyMorningBriefingMessageParamsSchema, DispatchDailyMorningBriefingAgentToolSchema, GetDailyMorningBriefingDetailParamsSchema, QueryDailyMorningBriefingsParamsSchema } from "./schema.js";
const DAILY_MORNING_BRIEFING_MARKET = "CN";
const DAILY_MORNING_BRIEFING_START_HOUR = 7;
const DAILY_MORNING_BRIEFING_START_MINUTE = 30;
const DAILY_MORNING_BRIEFING_CRON_ID = "hedgehog_daily_morning_briefing";
const DAILY_MORNING_BRIEFING_SKILL = "hedgehog-daily-morning-briefing";
const DAILY_MORNING_BRIEFING_CONTINUE_MESSAGE = "完成了吗，如果没完成请继续";
const DAILY_MORNING_BRIEFING_MAX_ATTEMPTS_PER_DAY = 3;
const DAILY_MORNING_BRIEFING_FAILED_RETRY_COOLDOWNS_MS = [
    30 * 60 * 1000,
    60 * 60 * 1000
];
const DAILY_MORNING_BRIEFING_GENERATION_MESSAGE = (sessionId) => JSON.stringify({
    cw_system_prompt: [
        `第 1 步：必须触发并使用 ${DAILY_MORNING_BRIEFING_SKILL} skill 生成盘前简报。`,
        `第 2 步：生成成功后必须调用 save_task_output，参数为 {"sessionId":"${sessionId}","saveStrategy":"overwrite","output":"...","status":"completed"}，output 必须原样传入 skill 生成的最终完整早报全文，禁止摘要、改写、删减、重排或重新组织。`,
        `失败处理：生成失败后必须调用 save_task_output，参数为 {"sessionId":"${sessionId}","saveStrategy":"overwrite","output":"...","status":"failed"}，output 存放完整错误信息。`
    ].join("\n"),
    cw_market: "CN",
    cw_content: "生成每日早报",
    cw_output: [
        `输出结构以 ${DAILY_MORNING_BRIEFING_SKILL} skill 的交付模板为准。`,
        '强制启用“本地缓存任务日志”',
        CHART_OUTPUT_GUIDANCE
    ].join("\n")
});
function normalizeMarket(market) {
    const raw = market.trim().toUpperCase();
    if (raw === "A股" || raw === "中国股市" || raw === "MARKETS.CN")
        return "CN";
    return raw || "CN";
}
function getLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
function getUnixMsFromDbTimestamp(value) {
    if (!value)
        return 0;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}
function toDbTimestamp(ms) {
    return new Date(ms).toISOString();
}
function getFailedRetryCooldownMs(attemptCount) {
    if (attemptCount >= DAILY_MORNING_BRIEFING_MAX_ATTEMPTS_PER_DAY)
        return undefined;
    return DAILY_MORNING_BRIEFING_FAILED_RETRY_COOLDOWNS_MS[Math.max(0, attemptCount - 1)] ?? DAILY_MORNING_BRIEFING_FAILED_RETRY_COOLDOWNS_MS[DAILY_MORNING_BRIEFING_FAILED_RETRY_COOLDOWNS_MS.length - 1];
}
function getNextRetryAtForFailedAttempt(attemptCount, nowMs = Date.now()) {
    const cooldownMs = getFailedRetryCooldownMs(attemptCount);
    return typeof cooldownMs === "number" ? toDbTimestamp(nowMs + cooldownMs) : "";
}
function getHalfHourBucket() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = now.getMinutes() < 30 ? "00" : "30";
    return `${year}${month}${day}${hour}${minute}`;
}
function isBeforeDailyMorningBriefingStart() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = DAILY_MORNING_BRIEFING_START_HOUR * 60 + DAILY_MORNING_BRIEFING_START_MINUTE;
    return currentMinutes < startMinutes;
}
function buildDailyMorningBriefingId(market, briefingDate) {
    return `daily_morning_briefing_${market}_${briefingDate}`;
}
function buildDailyMorningBriefingSessionId(market, briefingDate) {
    return `agent:${HEDGEHOG_AGENT_ID}:cron:${DAILY_MORNING_BRIEFING_CRON_ID}:${market}:${briefingDate}`;
}
async function scheduleDailyMorningBriefingTurn(action, sessionKey, message, idempotencyKey) {
    await scheduleDailyMorningBriefingTurnCron({
        action,
        sessionKey,
        message,
        idempotencyKey
    });
}
function selectDailyMorningBriefing(db, sessionId) {
    const row = db.prepare(`
		SELECT id, reference, content, status, created_at, updated_at
		FROM agent_sessions
		WHERE id = ? AND biz_type = 'morning_briefing'
	`).get(sessionId);
    if (!row)
        throw new Error("daily morning briefing was not saved");
    const ref = JSON.parse(row.reference || "{}");
    return {
        id: row.id,
        market: ref.market || "CN",
        briefingDate: ref.briefingDate || "",
        content: row.content,
        status: row.status,
        sessionId: row.id,
        watchlistSnapshot: ref.watchlistSnapshot || [],
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function findSessionIdByBriefingId(db, briefingId) {
    const row = db.prepare(`
		SELECT id
		FROM agent_sessions
		WHERE id = ? AND biz_type = 'morning_briefing'
	`).get(briefingId);
    return row?.id;
}
function syncWorkAndTaskStatus(db, sessionId, status, content) {
    const session = db.prepare("SELECT work_id, task_id FROM agent_sessions WHERE id = ?").get(sessionId);
    if (session?.work_id && session?.task_id) {
        // 1. Map to works.status (pending, running, paused, completed, failed, cancelled)
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
        else if (status === "pending" || status === "scheduled") {
            workStatus = "pending";
        }
        else if (status === "paused") {
            workStatus = "paused";
        }
        else if (status === "running" || status === "generating") {
            workStatus = "running";
        }
        // 2. Map to tasks.status (pending, running, completed, failed, skipped)
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
        else if (status === "pending" || status === "scheduled") {
            taskStatus = "pending";
        }
        else if (status === "running" || status === "generating" || status === "paused") {
            taskStatus = "running";
        }
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
function updateDailyMorningBriefingStatus(db, sessionId, status, content, watchlistSnapshot, nextRetryAt, lastNudgeAt, attemptCount) {
    const row = db.prepare("SELECT reference FROM agent_sessions WHERE id = ?").get(sessionId);
    const refObj = JSON.parse(row?.reference || "{}");
    if (watchlistSnapshot)
        refObj.watchlistSnapshot = JSON.parse(watchlistSnapshot || "[]");
    if (nextRetryAt !== undefined)
        refObj.nextRetryAt = nextRetryAt;
    if (lastNudgeAt !== undefined)
        refObj.lastNudgeAt = lastNudgeAt;
    if (attemptCount !== undefined)
        refObj.attemptCount = attemptCount;
    db.prepare(`
		UPDATE agent_sessions
		SET content = ?,
			status = ?,
			reference = ?,
			updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
		WHERE id = ?
	`).run(content, status, JSON.stringify(refObj), sessionId);
    syncWorkAndTaskStatus(db, sessionId, status, content);
}
function selectExistingActiveDailyMorningBriefing(db, market, briefingDate) {
    const row = db.prepare(`
		SELECT id
		FROM agent_sessions
		WHERE biz_type = 'morning_briefing'
			AND json_extract(reference, '$.market') = ?
			AND json_extract(reference, '$.briefingDate') = ?
			AND status IN ('generating', 'completed', 'active')
		ORDER BY
			CASE status WHEN 'completed' THEN 0 WHEN 'active' THEN 0 WHEN 'generating' THEN 1 ELSE 2 END,
			updated_at DESC,
			created_at DESC
		LIMIT 1
	`).get(market, briefingDate);
    return row ? selectDailyMorningBriefing(db, row.id) : undefined;
}
function isDailyMorningBriefingCompleted(db, sessionId) {
    const row = db.prepare(`
		SELECT status
		FROM agent_sessions
		WHERE id = ?
	`).get(sessionId);
    return row?.status === "completed";
}
function mapDailyMorningBriefingRow(row) {
    return {
        id: row.id,
        market: row.market,
        briefingDate: row.briefingDate,
        content: row.content,
        status: row.status,
        sessionId: row.sessionId,
        watchlistSnapshot: JSON.parse(row.watchlistSnapshot || "[]"),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}
function mapDailyMorningBriefingSummary(row) {
    return {
        id: row.id,
        market: row.market,
        briefingDate: row.briefingDate,
        status: row.status,
        sessionId: row.sessionId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}
function summarizeDailyMorningBriefing(data) {
    if (!data)
        return undefined;
    return mapDailyMorningBriefingSummary(data);
}
function summarizeDailyMorningBriefingPersistence(data) {
    return {
        ...mapDailyMorningBriefingSummary(data),
        persisted: true,
        contentLength: data.content?.length || 0
    };
}
function getFullWatchlistSnapshot(db) {
    const stocks = db.prepare(`
		SELECT id, userId, stock_code, stock_name, exchange, market, sortOrder, createdAt
		FROM watchlist
		WHERE isDeleted = 0
		ORDER BY userId ASC, sortOrder ASC
	`).all();
    return stocks.map(stock => {
        const industries = db.prepare(`
			SELECT c.name FROM industry_theme_categories c
			JOIN watchlist_industry_items i ON c.id = i.categoryId
			WHERE i.watchlistId = ? ORDER BY i.weight DESC
		`).all(stock.id);
        const themes = db.prepare(`
			SELECT c.name FROM industry_theme_categories c
			JOIN watchlist_theme_items t ON c.id = t.categoryId
			WHERE t.watchlistId = ? ORDER BY t.weight DESC
		`).all(stock.id);
        return {
            ...stock,
            industries: industries.map(item => item.name),
            themes: themes.map(item => item.name)
        };
    });
}
function insertScheduledDailyMorningBriefing(db, market, briefingDate, id, sessionId, lastNudgeAt, watchlistSnapshot) {
    const workId = `work_${sessionId}`;
    const taskId = `task_${sessionId}`;
    const refObj = {
        market,
        briefingDate,
        watchlistSnapshot: JSON.parse(watchlistSnapshot || "[]"),
        lastNudgeAt,
        nextRetryAt: "",
        attemptCount: 1
    };
    db.prepare(`
		INSERT OR IGNORE INTO works (id, name, description, status, orchestrator_type, created_by)
		VALUES (?, ?, '每日早报生成工作流', 'running', 'hard', 'scheduler')
	`).run(workId, `每日早报工作流 (${market} ${briefingDate})`);
    db.prepare(`
		INSERT OR IGNORE INTO tasks (id, work_id, name, status, agent_session_id)
		VALUES (?, ?, '生成每日早报', 'running', ?)
	`).run(taskId, workId, sessionId);
    db.prepare(`
		INSERT OR IGNORE INTO agent_sessions (id, session_name, biz_type, status, reference, work_id, task_id)
		VALUES (?, ?, 'morning_briefing', 'scheduled', ?, ?, ?)
	`).run(sessionId, `每日早报 (${market} ${briefingDate})`, JSON.stringify(refObj), workId, taskId);
    return selectDailyMorningBriefing(db, sessionId);
}
function markDailyMorningBriefingFailed(db, sessionId, content) {
    const row = db.prepare(`
		SELECT reference
		FROM agent_sessions
		WHERE id = ?
	`).get(sessionId);
    const refObj = JSON.parse(row?.reference || "{}");
    const attemptCount = Math.max(1, Number(refObj.attemptCount) || 1);
    const nextRetryAt = getNextRetryAtForFailedAttempt(attemptCount);
    refObj.nextRetryAt = nextRetryAt;
    db.prepare(`
		UPDATE agent_sessions
		SET status = 'failed',
			content = ?,
			reference = ?,
			updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
		WHERE id = ?
			AND status != 'completed'
	`).run(content, JSON.stringify(refObj), sessionId);
    syncWorkAndTaskStatus(db, sessionId, "failed", content);
    return true;
}
function claimDailyMorningBriefingDispatch(db, market, briefingDate) {
    if (isBeforeDailyMorningBriefingStart()) {
        return { action: "skip", reason: "before_start_time" };
    }
    const expectedSessionId = buildDailyMorningBriefingSessionId(market, briefingDate);
    const watchlistSnapshot = JSON.stringify(getFullWatchlistSnapshot(db));
    db.exec("BEGIN IMMEDIATE");
    try {
        const existing = db.prepare(`
			SELECT id, reference, content, status, created_at, updated_at
			FROM agent_sessions
			WHERE id = ?
		`).get(expectedSessionId);
        const existingBriefing = existing ? selectDailyMorningBriefing(db, expectedSessionId) : undefined;
        const refObj = existing ? JSON.parse(existing.reference || "{}") : {};
        const attemptCount = Number(refObj.attemptCount) || 1;
        const lastNudgeAt = refObj.lastNudgeAt || "";
        const nextRetryAt = refObj.nextRetryAt || "";
        if (existing?.status === "completed" || existing?.status === "active") {
            db.exec("COMMIT");
            return { action: "skip", reason: "already_completed", data: existingBriefing };
        }
        if (existing?.status === "generating") {
            const halfHourBucket = getHalfHourBucket();
            if (lastNudgeAt === halfHourBucket) {
                db.exec("COMMIT");
                return { action: "skip", reason: "nudge_throttled", data: existingBriefing };
            }
            updateDailyMorningBriefingStatus(db, expectedSessionId, "generating", existing.content, watchlistSnapshot, nextRetryAt, halfHourBucket);
            const data = selectDailyMorningBriefing(db, expectedSessionId);
            db.exec("COMMIT");
            return { action: "continue", data, idempotencyKey: `${expectedSessionId}:continue:${halfHourBucket}` };
        }
        if (existing?.status === "scheduled") {
            const halfHourBucket = getHalfHourBucket();
            if (lastNudgeAt === halfHourBucket) {
                db.exec("COMMIT");
                return { action: "skip", reason: "nudge_throttled", data: existingBriefing };
            }
            updateDailyMorningBriefingStatus(db, expectedSessionId, "scheduled", existing.content, watchlistSnapshot, nextRetryAt, halfHourBucket);
            const data = selectDailyMorningBriefing(db, expectedSessionId);
            db.exec("COMMIT");
            return { action: "start", data, idempotencyKey: `${expectedSessionId}:start:${data.sessionId}:${halfHourBucket}` };
        }
        if (existing) {
            const currentAttemptCount = Math.max(0, attemptCount);
            const nextAttemptCount = currentAttemptCount > 0 ? currentAttemptCount + 1 : 1;
            if (nextAttemptCount > DAILY_MORNING_BRIEFING_MAX_ATTEMPTS_PER_DAY) {
                db.exec("COMMIT");
                return { action: "skip", reason: "max_attempts_reached", data: existingBriefing };
            }
            const nextRetryAtMs = getUnixMsFromDbTimestamp(nextRetryAt);
            if (nextRetryAtMs > Date.now()) {
                db.exec("COMMIT");
                return { action: "skip", reason: "retry_cooling_down", nextRetryAt, data: existingBriefing };
            }
            updateDailyMorningBriefingStatus(db, expectedSessionId, "scheduled", "", watchlistSnapshot, "", getHalfHourBucket(), nextAttemptCount);
        }
        else {
            insertScheduledDailyMorningBriefing(db, market, briefingDate, expectedSessionId, expectedSessionId, getHalfHourBucket(), watchlistSnapshot);
        }
        const data = selectDailyMorningBriefing(db, expectedSessionId);
        db.exec("COMMIT");
        return { action: "start", data, idempotencyKey: `${expectedSessionId}:start:${data.sessionId}` };
    }
    catch (e) {
        if (db.inTransaction)
            db.exec("ROLLBACK");
        throw e;
    }
}
async function dispatchDailyMorningBriefing() {
    const db = getDB();
    const market = DAILY_MORNING_BRIEFING_MARKET;
    const briefingDate = getLocalDateString();
    const decision = claimDailyMorningBriefingDispatch(db, market, briefingDate);
    if (decision.action === "skip") {
        return JSON.stringify({ success: true, skipped: true, reason: decision.reason, nextRetryAt: decision.nextRetryAt, data: summarizeDailyMorningBriefing(decision.data) });
    }
    if (isDailyMorningBriefingCompleted(db, decision.data.id)) {
        return JSON.stringify({ success: true, skipped: true, reason: "already_completed", data: summarizeDailyMorningBriefing(decision.data) });
    }
    if (decision.action === "continue") {
        await scheduleDailyMorningBriefingTurn("continue", decision.data.sessionId, DAILY_MORNING_BRIEFING_CONTINUE_MESSAGE, decision.idempotencyKey);
        return JSON.stringify({ success: true, skipped: true, reason: "already_generating", action: "continued", data: summarizeDailyMorningBriefing(decision.data) });
    }
    try {
        await scheduleDailyMorningBriefingTurn("start", decision.data.sessionId, DAILY_MORNING_BRIEFING_GENERATION_MESSAGE(decision.data.sessionId), decision.idempotencyKey);
    }
    catch (e) {
        markDailyMorningBriefingFailed(db, decision.data.id, e instanceof Error ? e.message : String(e));
        throw e;
    }
    return JSON.stringify({ success: true, action: "started", data: summarizeDailyMorningBriefing(decision.data) });
}
export const dailyMorningBriefingTools = {
    dispatch_daily_morning_briefing: {
        name: "dispatch_daily_morning_briefing",
        label: "调度每日盘前早报",
        description: "调度每日盘前早报。7:30 前跳过；当天已完成则跳过；当天生成中则通过会话调度发送“完成了吗，如果没完成请继续”；当天未触发则创建当天生成记录并在按日期隔离的会话中启动早报生成。",
        parameters: DispatchDailyMorningBriefingAgentToolSchema,
        registerTool: true,
        async execute(_params, ctx) {
            return dispatchDailyMorningBriefing();
        }
    },
    build_daily_morning_briefing_message: {
        name: "build_daily_morning_briefing_message",
        label: "构建每日盘前早报消息",
        description: "发起每日盘前早报生成任务。接口内部使用固定业务会话调度 agent turn，并返回调度结果；调用方不需要提交额外的聊天消息。",
        parameters: BuildDailyMorningBriefingMessageAgentToolSchema,
        registerTool: false,
        async execute(params) {
            BuildDailyMorningBriefingMessageParamsSchema.parse(params ?? {});
            return dispatchDailyMorningBriefing();
        }
    },
    query_daily_morning_briefings: {
        name: "query_daily_morning_briefings",
        label: "查询每日盘前早报",
        description: "分页查询每日盘前早报记录列表。支持按市场过滤，返回记录标识、早报日期、状态和时间字段；列表结果不包含 content，详情内容请使用详情查询接口获取。",
        parameters: QueryDailyMorningBriefingsParamsSchema,
        registerTool: false,
        async execute(params) {
            const args = QueryDailyMorningBriefingsParamsSchema.parse(params ?? {});
            const db = getDB();
            const market = normalizeMarket(args.market);
            const offset = (args.page - 1) * args.pageSize;
            const total = db.prepare(`
				SELECT COUNT(*) AS total
				FROM agent_sessions
				WHERE biz_type = 'morning_briefing'
					AND json_extract(reference, '$.market') = ?
			`).get(market).total || 0;
            const rows = db.prepare(`
				SELECT id, reference, status, created_at, updated_at
				FROM agent_sessions
				WHERE biz_type = 'morning_briefing'
					AND json_extract(reference, '$.market') = ?
				ORDER BY json_extract(reference, '$.briefingDate') DESC, updated_at DESC
				LIMIT ? OFFSET ?
			`).all(market, args.pageSize, offset);
            const data = rows.map(r => {
                const ref = JSON.parse(r.reference || "{}");
                return mapDailyMorningBriefingSummary({
                    id: r.id,
                    market: ref.market || "CN",
                    briefingDate: ref.briefingDate || "",
                    status: r.status,
                    sessionId: r.id,
                    createdAt: r.created_at,
                    updatedAt: r.updated_at
                });
            });
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
    get_daily_morning_briefing_detail: {
        name: "get_daily_morning_briefing_detail",
        label: "查询每日盘前早报详情",
        description: "根据每日盘前早报 ID 查询完整详情。返回早报正文 content、自选股快照 watchlistSnapshot 以及市场、日期、状态和时间等元数据；status=failed 时 content 为错误信息。",
        parameters: GetDailyMorningBriefingDetailParamsSchema,
        registerTool: false,
        async execute(params) {
            const args = GetDailyMorningBriefingDetailParamsSchema.parse(params);
            const db = getDB();
            const data = selectDailyMorningBriefing(db, args.id);
            return JSON.stringify({ success: true, data });
        }
    }
};
//# sourceMappingURL=tools.js.map