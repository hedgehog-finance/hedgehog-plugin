import { getDB } from "../../core/database.js";
import { scheduleDailyMorningBriefingTurnCron } from "../../dailyMorningBriefingCron.js";
import { HEDGEHOG_AGENT_ID } from "../../openclawConstants.js";
import { CHART_OUTPUT_GUIDANCE } from "../chartOutput.js";
import { BuildDailyMorningBriefingMessageAgentToolSchema, BuildDailyMorningBriefingMessageParamsSchema, DispatchDailyMorningBriefingAgentToolSchema, GetDailyMorningBriefingDetailParamsSchema, QueryDailyMorningBriefingsParamsSchema, SaveDailyMorningBriefingAgentToolSchema, SaveDailyMorningBriefingParamsSchema } from "./schema.js";
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
const DAILY_MORNING_BRIEFING_GENERATION_MESSAGE = JSON.stringify({
    cw_system_prompt: [
        "第 1 步：开始分析前必须先调用 save_daily_morning_briefing，参数为 {\"status\":\"generating\",\"content\":\"\"}；如果返回 skipped=true，必须立即停止，不要继续调用 skill 或生成正文。",
        `第 2 步：必须触发并使用 ${DAILY_MORNING_BRIEFING_SKILL} skill 生成盘前简报。`,
        "第 3 步：生成成功后必须调用 save_daily_morning_briefing，参数为 {\"status\":\"completed\",\"content\":\"...\"}，content 必须原样传入 skill 生成的最终完整早报全文，禁止摘要、改写、删减、重排或重新组织。",
        "失败处理：生成失败后必须调用 save_daily_morning_briefing，参数为 {\"status\":\"failed\",\"content\":\"...\"}，content 存放完整错误信息。",
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
function buildDailyMorningBriefingAttemptSessionId(market, briefingDate, attemptCount) {
    return buildDailyMorningBriefingSessionId(market, briefingDate);
}
async function scheduleDailyMorningBriefingTurn(action, sessionKey, message, idempotencyKey) {
    await scheduleDailyMorningBriefingTurnCron({
        action,
        sessionKey,
        message,
        idempotencyKey
    });
}
function selectDailyMorningBriefing(db, id) {
    const row = db.prepare(`
		SELECT id, market, briefingDate, content, status, sessionId, watchlistSnapshot, createdAt, updatedAt
		FROM daily_morning_briefings
		WHERE id = ?
	`).get(id);
    if (!row)
        throw new Error("daily morning briefing was not saved");
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
function selectExistingActiveDailyMorningBriefing(db, market, briefingDate) {
    const row = db.prepare(`
		SELECT id
		FROM daily_morning_briefings
		WHERE market = ?
			AND briefingDate = ?
			AND status IN ('generating', 'completed')
		ORDER BY
			CASE status WHEN 'completed' THEN 0 WHEN 'generating' THEN 1 ELSE 2 END,
			updatedAt DESC,
			createdAt DESC
		LIMIT 1
	`).get(market, briefingDate);
    return row ? selectDailyMorningBriefing(db, row.id) : undefined;
}
function isDailyMorningBriefingCompleted(db, id) {
    const row = db.prepare(`
		SELECT status
		FROM daily_morning_briefings
		WHERE id = ?
	`).get(id);
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
    db.prepare(`
		INSERT INTO daily_morning_briefings (id, market, briefingDate, content, status, sessionId, lastNudgeAt, nextRetryAt, attemptCount, watchlistSnapshot)
		VALUES (?, ?, ?, '', 'scheduled', ?, ?, '', 1, ?)
	`).run(id, market, briefingDate, sessionId, lastNudgeAt, watchlistSnapshot);
    return selectDailyMorningBriefing(db, id);
}
function markDailyMorningBriefingFailed(db, id, content) {
    const row = db.prepare(`
		SELECT attemptCount
		FROM daily_morning_briefings
		WHERE id = ?
	`).get(id);
    const attemptCount = Math.max(1, Number(row?.attemptCount) || 1);
    const result = db.prepare(`
		UPDATE daily_morning_briefings
		SET status = 'failed',
			content = ?,
			nextRetryAt = ?,
			updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
		WHERE id = ?
			AND status != 'completed'
	`).run(content, getNextRetryAtForFailedAttempt(attemptCount), id);
    return result.changes > 0;
}
function claimDailyMorningBriefingDispatch(db, market, briefingDate) {
    if (isBeforeDailyMorningBriefingStart()) {
        return { action: "skip", reason: "before_start_time" };
    }
    const id = buildDailyMorningBriefingId(market, briefingDate);
    const watchlistSnapshot = JSON.stringify(getFullWatchlistSnapshot(db));
    db.exec("BEGIN IMMEDIATE");
    try {
        const existing = db.prepare(`
			SELECT id, market, briefingDate, content, status, sessionId, lastNudgeAt, nextRetryAt, attemptCount, watchlistSnapshot, createdAt, updatedAt
			FROM daily_morning_briefings
			WHERE id = ?
		`).get(id);
        if (existing?.status === "completed") {
            db.exec("COMMIT");
            return { action: "skip", reason: "already_completed", data: mapDailyMorningBriefingRow(existing) };
        }
        if (existing?.status === "generating") {
            const halfHourBucket = getHalfHourBucket();
            if (existing.lastNudgeAt === halfHourBucket) {
                db.exec("COMMIT");
                return { action: "skip", reason: "nudge_throttled", data: mapDailyMorningBriefingRow(existing) };
            }
            db.prepare(`
				UPDATE daily_morning_briefings
				SET lastNudgeAt = ?,
					updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
				WHERE id = ?
					AND status = 'generating'
			`).run(halfHourBucket, id);
            const data = selectDailyMorningBriefing(db, id);
            db.exec("COMMIT");
            return { action: "continue", data, idempotencyKey: `${id}:continue:${halfHourBucket}` };
        }
        if (existing?.status === "scheduled") {
            const halfHourBucket = getHalfHourBucket();
            if (existing.lastNudgeAt === halfHourBucket) {
                db.exec("COMMIT");
                return { action: "skip", reason: "nudge_throttled", data: mapDailyMorningBriefingRow(existing) };
            }
            db.prepare(`
				UPDATE daily_morning_briefings
				SET lastNudgeAt = ?,
					updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
				WHERE id = ?
					AND status = 'scheduled'
			`).run(halfHourBucket, id);
            const data = selectDailyMorningBriefing(db, id);
            db.exec("COMMIT");
            return { action: "start", data, idempotencyKey: `${id}:start:${data.sessionId}:${halfHourBucket}` };
        }
        if (existing) {
            const currentAttemptCount = Math.max(0, Number(existing.attemptCount) || 0);
            const nextAttemptCount = currentAttemptCount > 0 ? currentAttemptCount + 1 : 1;
            if (nextAttemptCount > DAILY_MORNING_BRIEFING_MAX_ATTEMPTS_PER_DAY) {
                db.exec("COMMIT");
                return { action: "skip", reason: "max_attempts_reached", data: mapDailyMorningBriefingRow(existing) };
            }
            const nextRetryAtMs = getUnixMsFromDbTimestamp(existing.nextRetryAt);
            if (nextRetryAtMs > Date.now()) {
                db.exec("COMMIT");
                return { action: "skip", reason: "retry_cooling_down", nextRetryAt: existing.nextRetryAt, data: mapDailyMorningBriefingRow(existing) };
            }
            const sessionId = buildDailyMorningBriefingAttemptSessionId(market, briefingDate, nextAttemptCount);
            db.prepare(`
				UPDATE daily_morning_briefings
				SET content = '',
					status = 'scheduled',
					sessionId = ?,
					lastNudgeAt = ?,
					nextRetryAt = '',
					attemptCount = ?,
					watchlistSnapshot = ?,
					updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
				WHERE id = ?
					AND status != 'completed'
			`).run(sessionId, getHalfHourBucket(), nextAttemptCount, watchlistSnapshot, id);
        }
        else {
            insertScheduledDailyMorningBriefing(db, market, briefingDate, id, buildDailyMorningBriefingAttemptSessionId(market, briefingDate, 1), getHalfHourBucket(), watchlistSnapshot);
        }
        const data = selectDailyMorningBriefing(db, id);
        db.exec("COMMIT");
        return { action: "start", data, idempotencyKey: `${id}:start:${data.sessionId}` };
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
        await scheduleDailyMorningBriefingTurn("start", decision.data.sessionId, DAILY_MORNING_BRIEFING_GENERATION_MESSAGE, decision.idempotencyKey);
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
    save_daily_morning_briefing: {
        name: "save_daily_morning_briefing",
        label: "保存每日盘前早报",
        description: "保存每日盘前早报的生成进度和最终结果。生成前必须先以 status=generating、content=\"\" 调用；生成成功后以 status=completed 保存完整正文 content；生成失败后以 status=failed 保存完整错误信息。未传 id 时会自动使用当天固定记录，完成或失败时可直接更新当天早报。",
        parameters: SaveDailyMorningBriefingAgentToolSchema,
        registerTool: true,
        async execute(params, ctx) {
            const args = SaveDailyMorningBriefingParamsSchema.parse(params);
            const db = getDB();
            const market = DAILY_MORNING_BRIEFING_MARKET;
            const briefingDate = getLocalDateString();
            const id = args.id || buildDailyMorningBriefingId(market, briefingDate);
            const existing = db.prepare(`
				SELECT status, sessionId
				FROM daily_morning_briefings
				WHERE id = ?
			`).get(id);
            const expectedSessionId = buildDailyMorningBriefingSessionId(market, briefingDate);
            const currentSessionId = ctx?.sessionKey?.trim() || ctx?.sessionId?.trim() || "";
            const sessionId = existing?.sessionId || expectedSessionId;
            if (args.status === "generating") {
                const isClaimedSession = (existing?.status === "scheduled" || existing?.status === "generating") && currentSessionId && existing.sessionId === currentSessionId;
                if (!isClaimedSession && isBeforeDailyMorningBriefingStart()) {
                    return JSON.stringify({ success: true, skipped: true, reason: "before_start_time" });
                }
                const active = selectExistingActiveDailyMorningBriefing(db, market, briefingDate);
                if (active) {
                    if (active.status === "generating" && currentSessionId && active.sessionId === currentSessionId) {
                        return JSON.stringify({ success: true, data: active });
                    }
                    const reason = active.status === "generating" ? "already_generating" : "already_completed";
                    return JSON.stringify({ success: true, skipped: true, reason, data: active });
                }
            }
            const watchlistSnapshot = JSON.stringify(getFullWatchlistSnapshot(db));
            const content = args.content.trim();
            const nextRetryAt = args.status === "failed" ? getNextRetryAtForFailedAttempt(1) : "";
            if (args.status === "failed") {
                const updated = markDailyMorningBriefingFailed(db, id, content);
                if (!updated) {
                    db.prepare(`
						INSERT INTO daily_morning_briefings (id, market, briefingDate, content, status, sessionId, nextRetryAt, attemptCount, watchlistSnapshot)
						VALUES (?, ?, ?, ?, 'failed', ?, ?, 1, ?)
					`).run(id, market, briefingDate, content, sessionId, nextRetryAt, watchlistSnapshot);
                }
                return JSON.stringify({ success: true, data: selectDailyMorningBriefing(db, id) });
            }
            const result = db.prepare(`
				UPDATE daily_morning_briefings
				SET content = ?,
					status = ?,
					watchlistSnapshot = ?,
					sessionId = CASE WHEN ? != '' THEN ? ELSE sessionId END,
					nextRetryAt = ?,
					updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
				WHERE id = ?
			`).run(content, args.status, watchlistSnapshot, sessionId, sessionId, nextRetryAt, id);
            if (result.changes === 0) {
                db.prepare(`
					INSERT INTO daily_morning_briefings (id, market, briefingDate, content, status, sessionId, lastNudgeAt, nextRetryAt, attemptCount, watchlistSnapshot)
					VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?)
				`).run(id, market, briefingDate, content, args.status, sessionId, args.status === "generating" ? 1 : 0, watchlistSnapshot);
            }
            const data = selectDailyMorningBriefing(db, id);
            return JSON.stringify({ success: true, data });
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
				FROM daily_morning_briefings
				WHERE market = ?
			`).get(market).total || 0;
            const rows = db.prepare(`
				SELECT id, market, briefingDate, status, sessionId, createdAt, updatedAt
				FROM daily_morning_briefings
				WHERE market = ?
				ORDER BY briefingDate DESC, updatedAt DESC
				LIMIT ? OFFSET ?
			`).all(market, args.pageSize, offset);
            return JSON.stringify({
                success: true,
                data: rows.map(mapDailyMorningBriefingSummary),
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