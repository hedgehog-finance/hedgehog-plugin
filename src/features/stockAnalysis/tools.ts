import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import {
	ArticleAiAnalysis,
	GetArticleAiAnalysisParamsSchema,
	GetStockAiAnalysisParamsSchema,
	QueryStockAiAnalysisHistoryParamsSchema,
	SaveArticleAiAnalysisParamsSchema,
	SaveStockAiAnalysisParamsSchema,
	StockAiAnalysis
} from "./schema.js";

interface RuntimeTool {
	name: string;
	description: string;
	parameters: unknown;
	registerTool?: boolean;
	execute(params: unknown, ctx: { userId: string }): Promise<string>;
}

export function normalizeStockCode(stock_code: string): string {
	return stock_code.trim().toUpperCase().replace(/\.SS$/i, ".SH");
}

function selectLatestStockAnalysis(
	db: ReturnType<typeof getDB>,
	userId: string,
	stock_code: string
): StockAiAnalysis | undefined {
	return db.prepare(`
		SELECT id, stock_code, stock_name, market, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE userId = ? AND stock_code = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(userId, stock_code) as StockAiAnalysis | undefined;
}

export function saveStockAiAnalysisRecord(
	db: ReturnType<typeof getDB>,
	userId: string,
	args: {
		stock_code: string;
		stock_name: string;
		market: string;
		content: string;
	}
): StockAiAnalysis {
	const stock_code = normalizeStockCode(args.stock_code);
	const id = randomUUID();

	db.prepare(`
		INSERT INTO stock_ai_analysis (id, userId, stock_code, stock_name, market, content)
		VALUES (?, ?, ?, ?, ?, ?)
	`).run(id, userId, stock_code, args.stock_name, args.market, args.content);

	return db.prepare(`
		SELECT id, stock_code, stock_name, market, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE userId = ? AND id = ?
	`).get(userId, id) as StockAiAnalysis;
}

function selectLatestArticleAnalysis(
	db: ReturnType<typeof getDB>,
	userId: string,
	sourceId: string,
	analysisType: ArticleAiAnalysis["analysisType"],
	market: string
): ArticleAiAnalysis | undefined {
	return db.prepare(`
		SELECT id, sourceId, analysisType, market, content, createdAt, updatedAt
		FROM article_ai_analysis
		WHERE userId = ? AND sourceId = ? AND analysisType = ? AND market = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(userId, sourceId, analysisType, market) as ArticleAiAnalysis | undefined;
}

function saveArticleAiAnalysisRecord(
	db: ReturnType<typeof getDB>,
	userId: string,
	args: {
		sourceId: string;
		analysisType: ArticleAiAnalysis["analysisType"];
		market: string;
		content: string;
	}
): ArticleAiAnalysis {
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
	`).get(userId, args.sourceId, args.analysisType, args.market) as ArticleAiAnalysis;
}

export const stockAnalysisTools: Record<string, RuntimeTool> = {
	get_stock_ai_analysis: {
		name: "get_stock_ai_analysis",
		description: "读取股票 AI 分析的最新一条历史记录；不触发模型分析。",
		parameters: GetStockAiAnalysisParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetStockAiAnalysisParamsSchema.parse(params);
			const db = getDB();
			const data = selectLatestStockAnalysis(db, ctx.userId, normalizeStockCode(args.stock_code));
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
			const stock_code = normalizeStockCode(args.stock_code);
			const offset = (args.page - 1) * args.pageSize;
			const rows = db.prepare(`
				SELECT id, stock_code, stock_name, market, content, createdAt, updatedAt
				FROM stock_ai_analysis
				WHERE userId = ? AND stock_code = ? AND market = ?
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT ? OFFSET ?
			`).all(ctx.userId, stock_code, args.market, args.pageSize, offset) as StockAiAnalysis[];
			const countRow = db.prepare(`
				SELECT COUNT(*) AS total
				FROM stock_ai_analysis
				WHERE userId = ? AND stock_code = ? AND market = ?
			`).get(ctx.userId, stock_code, args.market) as { total: number };
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
