import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import { CHART_OUTPUT_GUIDANCE, ensureChartPlaceholdersInBody } from "../chartOutput.js";
import {
	ArticleAiAnalysis,
	BuildStockAiAnalysisMessageParams,
	BuildStockAiAnalysisMessageParamsSchema,
	GetArticleAiAnalysisParamsSchema,
	GetStockAiAnalysisDetailBySessionParamsSchema,
	GetStockAiAnalysisDetailParamsSchema,
	GetStockAiAnalysisParamsSchema,
	QueryArticleAiAnalysisHistoryParamsSchema,
	QueryStockAiAnalysisStocksParamsSchema,
	QueryStockAiAnalysisHistoryParamsSchema,
	SaveStockAiAnalysisParamsSchema,
	StockAiAnalysis,
	StockAiAnalysisStockSummary,
	StockAiAnalysisWithoutContent
} from "./schema.js";

interface RuntimeTool {
	name: string;
	label?: string;
	description: string;
	parameters: unknown;
	registerTool?: boolean;
	execute(params: unknown, ctx?: { userId: string }): Promise<string>;
}

const STOCK_AI_ANALYSIS_SKILL = "hedgehog-stock-research";

const BuildStockAiAnalysisMessageAgentToolSchema = {
	type: "object",
	additionalProperties: false,
	required: ["stock_code", "stock_name"],
	properties: {
		stock_code: { type: "string", description: "股票代码" },
		stock_name: { type: "string", description: "股票名称" },
		market: { type: "string", description: "市场类型，默认 CN" },
		sessionId: { type: "string", description: "前端生成的会话 ID" }
	}
};

export function normalizeStockCode(stock_code: string): string {
	return stock_code.trim().toUpperCase().replace(/\.SS$/i, ".SH");
}

function resolveToolUserId(ctx?: { userId: string }): string {
	return ctx?.userId || "default";
}

function buildStockAiAnalysisContent(args: BuildStockAiAnalysisMessageParams): string {
	return [
		`分析一下${args.stock_name}股票`,
		"",
		`股票代码：${normalizeStockCode(args.stock_code)}`,
		`股票名称：${args.stock_name}`,
		`市场：${args.market}`
	].join("\n");
}

function buildStockAiAnalysisMessage(args: BuildStockAiAnalysisMessageParams): string {
	const stock_code = normalizeStockCode(args.stock_code);
	const sessionId = args.sessionId || "";
	const buildGeneratingSaveParams = () => JSON.stringify({
		stock_code,
		stock_name: args.stock_name,
		market: args.market,
		sessionId,
		status: "generating",
		content: ""
	});
	const buildFinalSaveParams = (status: "completed" | "failed") => JSON.stringify({
		stock_code,
		stock_name: args.stock_name,
		market: args.market,
		sessionId,
		status,
		content: "..."
	});
	return JSON.stringify({
		cw_system_prompt: [
			`开始分析前必须先调用 save_stock_ai_analysis，参数为 ${buildGeneratingSaveParams()}；如果返回 skipped=true，必须立即停止，不要继续调用 skill 或生成正文。`,
			`必须触发并使用 ${STOCK_AI_ANALYSIS_SKILL} skill 生成个股 AI 分析报告。`,
			`生成成功后必须调用 save_stock_ai_analysis，参数为 ${buildFinalSaveParams("completed")}，content 传最终完整个股分析正文。`,
			`生成失败后必须调用 save_stock_ai_analysis，参数为 ${buildFinalSaveParams("failed")}，content 存放完整错误信息。`,
			"如果最终内容包含 [图表数据]，正文必须已经包含所有对应图表占位符。"
		].join("\n"),
		cw_context: JSON.stringify({
			stock_code,
			stock_name: args.stock_name,
			market: args.market,
			sessionId,
			saveMode: "tool"
		}),
		cw_market: args.market,
		cw_stock_code: stock_code,
		cw_stock_name: args.stock_name,
		cw_content: buildStockAiAnalysisContent({ ...args, stock_code }),
		cw_output: [
			`输出结构以 ${STOCK_AI_ANALYSIS_SKILL} skill 的交付模板为准。`,
			CHART_OUTPUT_GUIDANCE
		].join("\n")
	});
}

function selectLatestStockAnalysis(
	db: ReturnType<typeof getDB>,
	stock_code: string,
	market: string
): StockAiAnalysis | undefined {
	return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE stock_code = ? AND market = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(stock_code, market) as StockAiAnalysis | undefined;
}

function selectLatestGeneratingStockAnalysis(
	db: ReturnType<typeof getDB>,
	stock_code: string,
	market: string,
	sessionId?: string
): StockAiAnalysis | undefined {
	const normalizedSessionId = sessionId?.trim() || "";
	if (normalizedSessionId) {
		const bySession = db.prepare(`
			SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
			FROM stock_ai_analysis
			WHERE stock_code = ? AND market = ? AND sessionId = ? AND status = 'generating'
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(stock_code, market, normalizedSessionId) as StockAiAnalysis | undefined;
		if (bySession) return bySession;
	}

	return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE stock_code = ? AND market = ? AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(stock_code, market) as StockAiAnalysis | undefined;
}

function selectStockAnalysisForUpdate(
	db: ReturnType<typeof getDB>,
	stock_code: string,
	market: string,
	sessionId: string
): StockAiAnalysis | undefined {
	if (sessionId) {
		const bySession = db.prepare(`
			SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
			FROM stock_ai_analysis
			WHERE stock_code = ? AND market = ? AND sessionId = ?
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(stock_code, market, sessionId) as StockAiAnalysis | undefined;
		if (bySession) return bySession;
	}

	return selectLatestGeneratingStockAnalysis(db, stock_code, market);
}

function selectStockAnalysisDetail(
	db: ReturnType<typeof getDB>,
	id: string
): StockAiAnalysis | undefined {
	return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE id = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(id) as StockAiAnalysis | undefined;
}

function selectStockAnalysisDetailBySession(
	db: ReturnType<typeof getDB>,
	sessionId: string,
	stock_code: string
): StockAiAnalysisWithoutContent | undefined {
	return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE sessionId = ? AND stock_code = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(sessionId, stock_code) as StockAiAnalysisWithoutContent | undefined;
}

function queryStockAnalysisStocks(
	db: ReturnType<typeof getDB>,
	market: string,
	page: number,
	pageSize: number
): { rows: StockAiAnalysisStockSummary[]; total: number } {
	const offset = (page - 1) * pageSize;
	const rows = db.prepare(`
		WITH grouped AS (
			SELECT
				stock_code,
				market,
				COUNT(*) AS analysisCount,
				MAX(updatedAt || '|' || createdAt || '|' || id) AS latestKey
			FROM stock_ai_analysis
			WHERE market = ?
			GROUP BY stock_code, market
		)
		SELECT
			a.stock_code,
			a.stock_name,
			a.market,
			a.id AS latestAnalysisId,
			a.status AS latestStatus,
			a.createdAt AS latestCreatedAt,
			a.updatedAt AS latestUpdatedAt,
			g.analysisCount
		FROM grouped g
		JOIN stock_ai_analysis a
			ON a.stock_code = g.stock_code
			AND a.market = g.market
			AND (a.updatedAt || '|' || a.createdAt || '|' || a.id) = g.latestKey
		ORDER BY a.updatedAt DESC, a.createdAt DESC
		LIMIT ? OFFSET ?
	`).all(market, pageSize, offset) as StockAiAnalysisStockSummary[];
	const countRow = db.prepare(`
		SELECT COUNT(*) AS total
		FROM (
			SELECT 1
			FROM stock_ai_analysis
			WHERE market = ?
			GROUP BY stock_code, market
		)
	`).get(market) as { total: number };
	return { rows, total: countRow.total || 0 };
}

export function saveStockAiAnalysisRecord(
	db: ReturnType<typeof getDB>,
	userId: string,
	args: {
		stock_code: string;
		stock_name?: string;
		market: string;
		sessionId?: string;
		content: string;
		status?: string;
	}
): StockAiAnalysis {
	const stock_code = normalizeStockCode(args.stock_code);
	const status = args.status || "completed";
	const stock_name = args.stock_name?.trim() || stock_code;
	const sessionId = args.sessionId?.trim() || "";
	const content = status === "completed" ? ensureChartPlaceholdersInBody(args.content) : args.content.trim();
	const id = randomUUID();

	const existing = status === "generating"
		? undefined
		: selectStockAnalysisForUpdate(db, stock_code, args.market, sessionId);
	if (existing) {
		db.prepare(`
			UPDATE stock_ai_analysis
			SET status = ?,
				content = ?,
				updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
			WHERE id = ?
		`).run(status, content, existing.id);
		return selectStockAnalysisDetail(db, existing.id) as StockAiAnalysis;
	}

	db.prepare(`
		INSERT INTO stock_ai_analysis (id, userId, stock_code, stock_name, market, sessionId, status, content)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`).run(id, userId, stock_code, stock_name, args.market, sessionId, status, content);

	return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE id = ?
	`).get(id) as StockAiAnalysis;
}

function tableForArticleAnalysis(analysisType: ArticleAiAnalysis["analysisType"]): string {
	return analysisType === "verification" ? "news_fact_check_analysis" : "news_deep_reasoning_analysis";
}

function selectLatestArticleAnalysis(
	db: ReturnType<typeof getDB>,
	sourceId: string,
	analysisType: ArticleAiAnalysis["analysisType"],
	market: string = "CN"
): ArticleAiAnalysis | undefined {
	const table = tableForArticleAnalysis(analysisType);
	if (analysisType === "deduction") {
		return db.prepare(`
			SELECT id, sourceId, ? AS analysisType, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
			FROM ${table}
			WHERE sourceId = ? AND market = ?
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(analysisType, sourceId, market) as ArticleAiAnalysis | undefined;
	}
	return db.prepare(`
		SELECT id, sourceId, ? AS analysisType, sourceTitle, sessionId, status, content, createdAt, updatedAt
		FROM ${table}
		WHERE sourceId = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(analysisType, sourceId) as ArticleAiAnalysis | undefined;
}

export const stockAnalysisTools: Record<string, RuntimeTool> = {
	get_stock_ai_analysis: {
		name: "get_stock_ai_analysis",
		description: "查询指定股票最新一条 AI 分析详情。该接口仅读取已持久化的分析结果，返回完整 content，不触发新的模型生成流程。",
		parameters: GetStockAiAnalysisParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetStockAiAnalysisParamsSchema.parse(params);
			const db = getDB();
			const data = selectLatestStockAnalysis(db, normalizeStockCode(args.stock_code), args.market);
			return JSON.stringify({ success: true, data: data || null });
		}
	},
	query_stock_ai_analysis_history: {
		name: "query_stock_ai_analysis_history",
		description: "分页查询股票 AI 分析记录列表。支持按股票代码和市场过滤，返回记录标识、股票信息、状态和时间字段；列表结果不包含 content，详情内容请使用详情查询接口获取。",
		parameters: QueryStockAiAnalysisHistoryParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = QueryStockAiAnalysisHistoryParamsSchema.parse(params ?? {});
			const db = getDB();
			const offset = (args.page - 1) * args.pageSize;
			const conditions = ["market = ?"];
			const queryParams: unknown[] = [args.market];
			if (args.stock_code) {
				conditions.push("stock_code = ?");
				queryParams.push(normalizeStockCode(args.stock_code));
			}
			const rows = db.prepare(`
				SELECT id, stock_code, stock_name, market, sessionId, status, createdAt, updatedAt
				FROM stock_ai_analysis
				WHERE ${conditions.join(" AND ")}
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT ? OFFSET ?
			`).all(...queryParams, args.pageSize, offset);
			const countRow = db.prepare(`
				SELECT COUNT(*) AS total
				FROM stock_ai_analysis
				WHERE ${conditions.join(" AND ")}
			`).get(...queryParams) as { total: number };
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
	query_stock_ai_analysis_stocks: {
		name: "query_stock_ai_analysis_stocks",
		description: "分页查询所有已经产生过个股 AI 分析记录的股票列表。按股票代码和市场去重，返回每只股票最近一次分析记录 ID、最近状态、最近更新时间和累计分析次数；不返回分析正文 content。",
		parameters: QueryStockAiAnalysisStocksParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = QueryStockAiAnalysisStocksParamsSchema.parse(params ?? {});
			const db = getDB();
			const { rows, total } = queryStockAnalysisStocks(db, args.market, args.page, args.pageSize);
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
	get_stock_ai_analysis_detail: {
		name: "get_stock_ai_analysis_detail",
		description: "根据分析记录 ID 查询股票 AI 分析详情。返回指定记录的完整分析内容 content 及元数据，用于详情页展示或历史记录回放。",
		parameters: GetStockAiAnalysisDetailParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetStockAiAnalysisDetailParamsSchema.parse(params);
			const db = getDB();
			const data = selectStockAnalysisDetail(db, args.id);
			return JSON.stringify({ success: true, data: data || null });
		}
	},
	get_stock_ai_analysis_detail_by_session: {
		name: "get_stock_ai_analysis_detail_by_session",
		description: "根据 sessionId 和股票代码查询个股 AI 分析详情元数据；不返回 content 正文。",
		parameters: GetStockAiAnalysisDetailBySessionParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetStockAiAnalysisDetailBySessionParamsSchema.parse(params);
			const db = getDB();
			const data = selectStockAnalysisDetailBySession(
				db,
				args.sessionId,
				normalizeStockCode(args.stock_code)
			);
			return JSON.stringify({ success: true, data: data || null });
		}
	},
	build_stock_ai_analysis_message: {
		name: "build_stock_ai_analysis_message",
		label: "构建个股分析消息",
		description: "根据股票代码、名称和市场构建用于主动 RPC 发起 Agent 个股 AI 分析任务的标准消息。该工具只返回提示词消息体，不触发定时任务，也不保存分析结果。",
		parameters: BuildStockAiAnalysisMessageAgentToolSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = BuildStockAiAnalysisMessageParamsSchema.parse(params);
			const db = getDB();
			const stock_code = normalizeStockCode(args.stock_code);
			const generating = selectLatestGeneratingStockAnalysis(db, stock_code, args.market, args.sessionId);
			if (generating) {
				return JSON.stringify({
					success: true,
					skipped: true,
					reason: "already_generating",
					data: generating
				});
			}
			const message = buildStockAiAnalysisMessage({ ...args, stock_code });
			const payload = JSON.parse(message);
			return JSON.stringify({
				success: true,
				data: {
					message,
					payload,
					stock_code,
					saveParams: {
						stock_code,
						stock_name: args.stock_name,
						market: args.market,
						sessionId: args.sessionId || ""
					},
					skill: STOCK_AI_ANALYSIS_SKILL
				}
			});
		}
	},
	save_stock_ai_analysis: {
		name: "save_stock_ai_analysis",
		description:
			"保存个股 AI 分析结果。生成前必须先以 status=generating、content=\"\" 调用，并传入 stock_code、stock_name、market；生成成功后以 status=completed 保存完整正文 content；生成失败后以 status=failed 保存完整错误信息。",
		parameters: SaveStockAiAnalysisParamsSchema,
		registerTool: true,
		async execute(params, ctx) {
			const args = SaveStockAiAnalysisParamsSchema.parse(params);
			const db = getDB();
			const userId = resolveToolUserId(ctx);
			if (args.status === "generating") {
				const stock_code = normalizeStockCode(args.stock_code);
				const generating = selectLatestGeneratingStockAnalysis(db, stock_code, args.market, args.sessionId);
				if (generating) {
					return JSON.stringify({ success: true, skipped: true, reason: "already_generating", data: generating });
				}
			}
			const data = saveStockAiAnalysisRecord(db, userId, args);
			return JSON.stringify({ success: true, data });
		}
	},
	get_article_ai_analysis: {
		name: "get_article_ai_analysis",
		description: "根据资讯来源 ID 查询文章 AI 分析详情。支持信息求证和深度推演两类结果，返回完整 content；该接口仅读取已持久化数据，不触发新的模型生成流程。",
		parameters: GetArticleAiAnalysisParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = GetArticleAiAnalysisParamsSchema.parse(params);
			const db = getDB();
			const data = selectLatestArticleAnalysis(db, args.sourceId, args.analysisType, args.market);
			return JSON.stringify({ success: true, data: data || null });
		}
	},
	query_article_ai_analysis_history: {
		name: "query_article_ai_analysis_history",
		description: "分页查询文章 AI 分析记录列表。支持按分析类型过滤，返回记录标识、sourceId、状态和时间字段；列表结果不包含 content，详情内容请按 sourceId 查询。",
		parameters: QueryArticleAiAnalysisHistoryParamsSchema,
		registerTool: false,
		async execute(params, ctx) {
			const args = QueryArticleAiAnalysisHistoryParamsSchema.parse(params ?? {});
			const db = getDB();
			const table = tableForArticleAnalysis(args.analysisType);
			const offset = (args.page - 1) * args.pageSize;
			const marketCondition = args.analysisType === "deduction" ? " AND market = ?" : "";
			const queryParams = args.analysisType === "deduction"
				? [args.analysisType, args.market, args.pageSize, offset]
				: [args.analysisType, args.pageSize, offset];
			const rows = db.prepare(`
					SELECT id, sourceId, ? AS analysisType, sourceTitle, ${args.analysisType === "deduction" ? "market," : ""} sessionId, status, createdAt, updatedAt
				FROM ${table}
				WHERE 1 = 1${marketCondition}
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT ? OFFSET ?
			`).all(...queryParams);
			const countParams = args.analysisType === "deduction" ? [args.market] : [];
			const countRow = db.prepare(`
				SELECT COUNT(*) AS total
				FROM ${table}
				WHERE 1 = 1${marketCondition}
			`).get(...countParams) as { total: number };
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
	}
};
