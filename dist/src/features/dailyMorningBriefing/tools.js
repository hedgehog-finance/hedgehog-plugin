import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import { QueryDailyMorningBriefingsParamsSchema, SaveDailyMorningBriefingParamsSchema } from "./schema.js";
const DAILY_MORNING_BRIEFING_MARKET = "CN";
const SaveDailyMorningBriefingAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    required: ["content"],
    properties: {
        content: { type: "string", description: "每日早报最终内容" }
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
function selectDailyMorningBriefing(db, id) {
    const row = db.prepare(`
		SELECT id, market, briefingDate, content, watchlistSnapshotJson, createdAt, updatedAt
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
        watchlistSnapshot: JSON.parse(row.watchlistSnapshotJson || "[]"),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}
function mapDailyMorningBriefingRow(row) {
    return {
        id: row.id,
        market: row.market,
        briefingDate: row.briefingDate,
        content: row.content,
        watchlistSnapshot: JSON.parse(row.watchlistSnapshotJson || "[]"),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
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
			SELECT c.name FROM watchlist_categories c
			JOIN watchlist_industry_items i ON c.id = i.categoryId
			WHERE i.watchlistId = ? ORDER BY i.weight DESC
		`).all(stock.id);
        const themes = db.prepare(`
			SELECT c.name FROM watchlist_categories c
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
function ensureChartPlaceholdersInBody(content) {
    const chartDataMatch = content.match(/(?:\*\*)?\[图表数据\](?:\*\*)?/);
    if (!chartDataMatch || typeof chartDataMatch.index !== "number")
        return content;
    const chartDataStart = chartDataMatch.index;
    const body = content.slice(0, chartDataStart);
    const chartData = content.slice(chartDataStart);
    const placeholders = Array.from(chartData.matchAll(/\{图\d+\}\s*:/g), match => match[0].replace(/\s*:$/, ""));
    const uniquePlaceholders = [...new Set(placeholders)];
    const missingPlaceholders = uniquePlaceholders.filter(placeholder => !body.includes(placeholder));
    if (missingPlaceholders.length === 0)
        return content;
    const insertion = [
        "## 图表",
        "",
        ...missingPlaceholders.flatMap(placeholder => [placeholder, ""])
    ].join("\n");
    return `${body.trimEnd()}\n\n${insertion}\n${chartData.trimStart()}`;
}
export const dailyMorningBriefingTools = {
    save_daily_morning_briefing: {
        name: "save_daily_morning_briefing",
        description: "保存每日盘前早报最终结果。",
        parameters: SaveDailyMorningBriefingAgentToolSchema,
        registerTool: true,
        async execute(params) {
            const args = SaveDailyMorningBriefingParamsSchema.parse(params);
            const db = getDB();
            const id = randomUUID();
            const market = DAILY_MORNING_BRIEFING_MARKET;
            const briefingDate = getLocalDateString();
            const watchlistSnapshotJson = JSON.stringify(getFullWatchlistSnapshot(db));
            const content = ensureChartPlaceholdersInBody(args.content);
            db.prepare(`
				INSERT INTO daily_morning_briefings (id, market, briefingDate, content, watchlistSnapshotJson)
				VALUES (?, ?, ?, ?, ?)
			`).run(id, market, briefingDate, content, watchlistSnapshotJson);
            const data = selectDailyMorningBriefing(db, id);
            return JSON.stringify({ success: true, data });
        }
    },
    query_daily_morning_briefings: {
        name: "query_daily_morning_briefings",
        description: "分页查询每日盘前早报历史记录。",
        parameters: QueryDailyMorningBriefingsParamsSchema,
        registerTool: false,
        async execute(params) {
            const args = QueryDailyMorningBriefingsParamsSchema.parse(params);
            const db = getDB();
            const market = normalizeMarket(args.market);
            const offset = (args.page - 1) * args.pageSize;
            const total = db.prepare(`
				SELECT COUNT(*) AS total
				FROM daily_morning_briefings
				WHERE market = ?
			`).get(market).total || 0;
            const rows = db.prepare(`
				SELECT id, market, briefingDate, content, watchlistSnapshotJson, createdAt, updatedAt
				FROM daily_morning_briefings
				WHERE market = ?
				ORDER BY briefingDate DESC, updatedAt DESC
				LIMIT ? OFFSET ?
			`).all(market, args.pageSize, offset);
            return JSON.stringify({
                success: true,
                data: rows.map(mapDailyMorningBriefingRow),
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