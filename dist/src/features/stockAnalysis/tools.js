import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import { GetArticleAiAnalysisParamsSchema, GetStockAiAnalysisParamsSchema, QueryStockAiAnalysisHistoryParamsSchema, SaveArticleAiAnalysisParamsSchema, SaveStockAiAnalysisParamsSchema } from "./schema.js";
export function normalizeStockCode(stockCode) {
    return stockCode.trim().toUpperCase().replace(/\.SS$/i, ".SH");
}
function selectLatestStockAnalysis(db, userId, stockCode) {
    return db.prepare(`
		SELECT id, stockCode, stockName, market, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE userId = ? AND stockCode = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(userId, stockCode);
}
export function saveStockAiAnalysisRecord(db, userId, args) {
    const stockCode = normalizeStockCode(args.stockCode);
    const id = randomUUID();
    db.prepare(`
		INSERT INTO stock_ai_analysis (id, userId, stockCode, stockName, market, content)
		VALUES (?, ?, ?, ?, ?, ?)
	`).run(id, userId, stockCode, args.stockName, args.market, args.content);
    return db.prepare(`
		SELECT id, stockCode, stockName, market, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE userId = ? AND id = ?
	`).get(userId, id);
}
function selectLatestArticleAnalysis(db, userId, sourceId, analysisType, market) {
    return db.prepare(`
		SELECT id, sourceId, analysisType, market, content, createdAt, updatedAt
		FROM article_ai_analysis
		WHERE userId = ? AND sourceId = ? AND analysisType = ? AND market = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(userId, sourceId, analysisType, market);
}
function saveArticleAiAnalysisRecord(db, userId, args) {
    const id = randomUUID();
    db.prepare(`
		INSERT INTO article_ai_analysis (id, sourceId, userId, analysisType, market, content)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(sourceId, userId, analysisType, market) DO UPDATE SET
			content = excluded.content,
			updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
	`).run(id, args.sourceId, userId, args.analysisType, args.market, args.content);
    return db.prepare(`
		SELECT id, sourceId, analysisType, market, content, createdAt, updatedAt
		FROM article_ai_analysis
		WHERE userId = ? AND sourceId = ? AND analysisType = ? AND market = ?
	`).get(userId, args.sourceId, args.analysisType, args.market);
}
export const stockAnalysisTools = {
    get_stock_ai_analysis: {
        name: "get_stock_ai_analysis",
        description: "读取股票 AI 分析的最新一条历史记录；不触发模型分析。",
        parameters: GetStockAiAnalysisParamsSchema,
        registerTool: false,
        async execute(params, ctx) {
            const args = GetStockAiAnalysisParamsSchema.parse(params);
            const db = getDB();
            const data = selectLatestStockAnalysis(db, ctx.userId, normalizeStockCode(args.stockCode));
            return JSON.stringify({ success: true, data: data || null });
        }
    },
    query_stock_ai_analysis_history: {
        name: "query_stock_ai_analysis_history",
        description: "分页读取股票 AI 分析历史记录；不触发模型分析。",
        parameters: QueryStockAiAnalysisHistoryParamsSchema,
        registerTool: false,
        async execute(params, ctx) {
            const args = QueryStockAiAnalysisHistoryParamsSchema.parse(params);
            const db = getDB();
            const stockCode = normalizeStockCode(args.stockCode);
            const offset = (args.page - 1) * args.pageSize;
            const rows = db.prepare(`
				SELECT id, stockCode, stockName, market, content, createdAt, updatedAt
				FROM stock_ai_analysis
				WHERE userId = ? AND stockCode = ? AND market = ?
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT ? OFFSET ?
			`).all(ctx.userId, stockCode, args.market, args.pageSize, offset);
            const countRow = db.prepare(`
				SELECT COUNT(*) AS total
				FROM stock_ai_analysis
				WHERE userId = ? AND stockCode = ? AND market = ?
			`).get(ctx.userId, stockCode, args.market);
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
    save_stock_ai_analysis: {
        name: "save_stock_ai_analysis",
        description: "追加保存一条股票 AI 分析历史记录。",
        parameters: SaveStockAiAnalysisParamsSchema,
        registerTool: false,
        async execute(params, ctx) {
            const args = SaveStockAiAnalysisParamsSchema.parse(params);
            const db = getDB();
            const data = saveStockAiAnalysisRecord(db, ctx.userId, args);
            return JSON.stringify({ success: true, data });
        }
    },
    get_article_ai_analysis: {
        name: "get_article_ai_analysis",
        description: "读取文章 AI 分析结果；支持信息求证与深度推演，不触发模型分析。",
        parameters: GetArticleAiAnalysisParamsSchema,
        registerTool: false,
        async execute(params, ctx) {
            const args = GetArticleAiAnalysisParamsSchema.parse(params);
            const db = getDB();
            const data = selectLatestArticleAnalysis(db, ctx.userId, args.id, args.analysisType, args.market);
            return JSON.stringify({ success: true, data: data || null });
        }
    },
    save_article_ai_analysis: {
        name: "save_article_ai_analysis",
        description: "保存文章 AI 分析结果；支持信息求证与深度推演。",
        parameters: SaveArticleAiAnalysisParamsSchema,
        registerTool: false,
        async execute(params, ctx) {
            const args = SaveArticleAiAnalysisParamsSchema.parse(params);
            const db = getDB();
            const data = saveArticleAiAnalysisRecord(db, ctx.userId, { ...args, sourceId: args.id });
            return JSON.stringify({ success: true, data });
        }
    }
};
//# sourceMappingURL=tools.js.map