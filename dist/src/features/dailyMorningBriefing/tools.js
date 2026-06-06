import { getDB } from "../../core/database.js";
import { ensureChartPlaceholdersInBody } from "../chartOutput.js";
import { GetDailyMorningBriefingDetailParamsSchema, QueryDailyMorningBriefingsParamsSchema, SaveDailyMorningBriefingParamsSchema } from "./schema.js";
const DAILY_MORNING_BRIEFING_MARKET = "CN";
const SaveDailyMorningBriefingAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: { type: "string", description: "每日盘前早报 ID；开始生成时不传，后续更新生成结果时必须传入开始时返回的 id" },
        content: { type: "string", description: "每日盘前早报正文；status=generating 时为空，status=failed 时存入错误信息" },
        status: { type: "string", enum: ["generating", "completed", "failed"], description: "保存状态：generating 表示开始生成，completed 表示生成成功，failed 表示生成失败" }
    }
};
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
function buildDailyMorningBriefingId(market, briefingDate) {
    return `daily_morning_briefing_${market}_${briefingDate}`;
}
function selectDailyMorningBriefing(db, id) {
    const row = db.prepare(`
		SELECT id, market, briefingDate, content, status, watchlistSnapshot, createdAt, updatedAt
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
function selectGeneratingDailyMorningBriefing(db, market, briefingDate) {
    const row = db.prepare(`
		SELECT id
		FROM daily_morning_briefings
		WHERE market = ?
			AND briefingDate = ?
			AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(market, briefingDate);
    return row ? selectDailyMorningBriefing(db, row.id) : undefined;
}
function mapDailyMorningBriefingRow(row) {
    return {
        id: row.id,
        market: row.market,
        briefingDate: row.briefingDate,
        content: row.content,
        status: row.status,
        watchlistSnapshot: JSON.parse(row.watchlistSnapshot || "[]"),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}
function mapDailyMorningBriefingSummary(row) {
    return row;
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
export const dailyMorningBriefingTools = {
    save_daily_morning_briefing: {
        name: "save_daily_morning_briefing",
        label: "保存每日盘前早报",
        description: "保存每日盘前早报的生成进度和最终结果。生成前必须先以 status=generating、content=\"\" 调用；生成成功后以 status=completed 保存完整正文 content；生成失败后以 status=failed 保存完整错误信息。未传 id 时会自动使用当天固定记录，完成或失败时可直接更新当天早报。",
        parameters: SaveDailyMorningBriefingAgentToolSchema,
        registerTool: true,
        async execute(params) {
            const args = SaveDailyMorningBriefingParamsSchema.parse(params);
            const db = getDB();
            const market = DAILY_MORNING_BRIEFING_MARKET;
            const briefingDate = getLocalDateString();
            const id = args.id || buildDailyMorningBriefingId(market, briefingDate);
            if (args.status === "generating") {
                const generating = selectGeneratingDailyMorningBriefing(db, market, briefingDate);
                if (generating) {
                    return JSON.stringify({ success: true, skipped: true, reason: "already_generating", data: generating });
                }
            }
            const watchlistSnapshot = JSON.stringify(getFullWatchlistSnapshot(db));
            const content = args.status === "completed" ? ensureChartPlaceholdersInBody(args.content) : args.content.trim();
            const result = db.prepare(`
				UPDATE daily_morning_briefings
				SET content = ?,
					status = ?,
					watchlistSnapshot = ?,
					updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
				WHERE id = ?
			`).run(content, args.status, watchlistSnapshot, id);
            if (result.changes === 0) {
                db.prepare(`
					INSERT INTO daily_morning_briefings (id, market, briefingDate, content, status, watchlistSnapshot)
					VALUES (?, ?, ?, ?, ?, ?)
				`).run(id, market, briefingDate, content, args.status, watchlistSnapshot);
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
				SELECT id, market, briefingDate, status, createdAt, updatedAt
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