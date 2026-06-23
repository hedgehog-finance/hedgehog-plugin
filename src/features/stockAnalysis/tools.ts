import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import { CHART_OUTPUT_GUIDANCE } from "../chartOutput.js";
import {
	ArticleAiAnalysis,
	BuildStockAiAnalysisMessageParams,
	BuildStockAiAnalysisMessageAgentToolSchema,
	BuildStockAiAnalysisMessageParamsSchema,
	GetArticleAiAnalysisParamsSchema,
	GetStockAiAnalysisDetailBySessionParamsSchema,
	GetStockAiAnalysisDetailParamsSchema,
	GetStockAiAnalysisParamsSchema,
	QueryArticleAiAnalysisHistoryParamsSchema,
	QueryStockAiAnalysisStocksParamsSchema,
	QueryStockAiAnalysisHistoryParamsSchema,
	RuntimeTool,
	StockAiAnalysis,
	StockAiAnalysisStockSummary,
	StockAiAnalysisWithoutContent
} from "./schema.js";

const STOCK_AI_ANALYSIS_SKILL = "hedgehog-stock-research";

export function normalizeStockCode(stock_code: string): string {
	return stock_code.trim().toUpperCase().replace(/\.SS$/i, ".SH");
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
	return JSON.stringify({
		cw_system_prompt: [
			`第 1 步：必须触发并使用 ${STOCK_AI_ANALYSIS_SKILL} skill 生成个股 AI 分析报告。`,
			`第 2 步：生成成功后必须调用 save_task_output，参数为 {"sessionId":"${sessionId}","saveStrategy":"overwrite","output":"...","status":"completed"}，output 必须原样传入 skill 生成的最终完整个股分析报告全文，禁止摘要、改写、删减、重排或重新组织。`,
			`失败处理：生成失败后必须调用 save_task_output，参数为 {"sessionId":"${sessionId}","saveStrategy":"overwrite","output":"...","status":"failed"}，output 存放完整错误信息。`,
		].join("\n"),
		cw_market: args.market,
		cw_content: buildStockAiAnalysisContent({ ...args, stock_code }),
		cw_output: [
			`输出结构以 ${STOCK_AI_ANALYSIS_SKILL} skill 的交付模板为准。`,
			'强制启用“本地缓存任务日志”',
			CHART_OUTPUT_GUIDANCE
		].join("\n")
	});
}

function mapRowToStockAnalysis(row: any): StockAiAnalysis {
	const ref = JSON.parse(row.reference || "{}");
	return {
		id: row.id,
		stock_code: ref.stock_code || "",
		stock_name: ref.stock_name || "",
		market: ref.market_type || "CN",
		sessionId: row.id,
		status: row.status,
		content: row.content,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function selectLatestStockAnalysis(
	db: ReturnType<typeof getDB>,
	stock_code: string,
	market: string
): StockAiAnalysis | undefined {
	const row = db.prepare(`
		SELECT id, reference, status, content, created_at, updated_at
		FROM agent_sessions
		WHERE biz_type = 'stock_analysis'
			AND json_extract(reference, '$.stock_code') = ?
			AND json_extract(reference, '$.market_type') = ?
		ORDER BY updated_at DESC, created_at DESC
		LIMIT 1
	`).get(stock_code, market) as any;
	return row ? mapRowToStockAnalysis(row) : undefined;
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
			SELECT id, reference, status, content, created_at, updated_at
			FROM agent_sessions
			WHERE biz_type = 'stock_analysis'
				AND json_extract(reference, '$.stock_code') = ?
				AND json_extract(reference, '$.market_type') = ?
				AND id = ?
				AND status = 'generating'
			ORDER BY updated_at DESC, created_at DESC
			LIMIT 1
		`).get(stock_code, market, normalizedSessionId) as any;
		if (bySession) return mapRowToStockAnalysis(bySession);
	}

	const row = db.prepare(`
		SELECT id, reference, status, content, created_at, updated_at
		FROM agent_sessions
		WHERE biz_type = 'stock_analysis'
			AND json_extract(reference, '$.stock_code') = ?
			AND json_extract(reference, '$.market_type') = ?
			AND status = 'generating'
		ORDER BY updated_at DESC, created_at DESC
		LIMIT 1
	`).get(stock_code, market) as any;
	return row ? mapRowToStockAnalysis(row) : undefined;
}

function selectStockAnalysisDetail(
	db: ReturnType<typeof getDB>,
	id: string
): StockAiAnalysis | undefined {
	const row = db.prepare(`
		SELECT id, reference, status, content, created_at, updated_at
		FROM agent_sessions
		WHERE id = ? AND biz_type = 'stock_analysis'
	`).get(id) as any;
	return row ? mapRowToStockAnalysis(row) : undefined;
}

function selectStockAnalysisDetailBySession(
	db: ReturnType<typeof getDB>,
	sessionId: string,
	stock_code: string
): StockAiAnalysisWithoutContent | undefined {
	const row = db.prepare(`
		SELECT id, reference, status, created_at, updated_at
		FROM agent_sessions
		WHERE id = ? AND biz_type = 'stock_analysis' AND json_extract(reference, '$.stock_code') = ?
		ORDER BY updated_at DESC, created_at DESC
		LIMIT 1
	`).get(sessionId, stock_code) as any;
	return row ? mapRowToStockAnalysis(row) : undefined;
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
				json_extract(reference, '$.stock_code') AS stock_code,
				json_extract(reference, '$.market_type') AS market,
				COUNT(*) AS analysisCount,
				MAX(updated_at || '|' || created_at || '|' || id) AS latestKey
			FROM agent_sessions
			WHERE biz_type = 'stock_analysis' AND json_extract(reference, '$.market_type') = ?
			GROUP BY stock_code, market
		)
		SELECT
			g.stock_code,
			json_extract(a.reference, '$.stock_name') AS stock_name,
			g.market,
			a.id AS latestAnalysisId,
			a.status AS latestStatus,
			a.created_at AS latestCreatedAt,
			a.updated_at AS latestUpdatedAt,
			g.analysisCount
		FROM grouped g
		JOIN agent_sessions a
			ON json_extract(a.reference, '$.stock_code') = g.stock_code
			AND json_extract(a.reference, '$.market_type') = g.market
			AND (a.updated_at || '|' || a.created_at || '|' || a.id) = g.latestKey
		ORDER BY a.updated_at DESC, a.created_at DESC
		LIMIT ? OFFSET ?
	`).all(market, pageSize, offset) as any[];

	const countRow = db.prepare(`
		SELECT COUNT(*) AS total
		FROM (
			SELECT 1
			FROM agent_sessions
			WHERE biz_type = 'stock_analysis' AND json_extract(reference, '$.market_type') = ?
			GROUP BY json_extract(reference, '$.stock_code'), json_extract(reference, '$.market_type')
		)
	`).get(market) as { total: number };

	const mappedRows = rows.map(r => ({
		stock_code: r.stock_code || "",
		stock_name: r.stock_name || "",
		market: r.market || "CN",
		latestAnalysisId: r.latestAnalysisId,
		latestStatus: r.latestStatus,
		latestCreatedAt: r.latestCreatedAt,
		latestUpdatedAt: r.latestUpdatedAt,
		analysisCount: r.analysisCount
	}));

	return { rows: mappedRows, total: countRow.total || 0 };
}

function createGeneratingStockAnalysis(
	db: ReturnType<typeof getDB>,
	args: {
		stock_code: string;
		stock_name?: string;
		market: string;
		sessionId: string;
	}
): StockAiAnalysis {
	const stock_code = normalizeStockCode(args.stock_code);
	const stock_name = args.stock_name?.trim() || stock_code;
	const sessionId = args.sessionId;

	const workId = `work_${sessionId}`;
	const taskId = `task_${sessionId}`;
	const refObj = {
		stock_code,
		stock_name,
		market_type: args.market
	};

	db.prepare(`
		INSERT OR IGNORE INTO works (id, name, description, status, orchestrator_type)
		VALUES (?, ?, '个股 AI 分析工作流', 'running', 'hard')
	`).run(workId, `个股 AI 分析工作流 (${stock_name})`);

	db.prepare(`
		INSERT OR IGNORE INTO tasks (id, work_id, name, status, agent_session_id, content)
		VALUES (?, ?, '执行个股 AI 分析', 'running', ?, '')
	`).run(taskId, workId, sessionId);

	db.prepare(`
		INSERT OR IGNORE INTO agent_sessions (id, session_name, biz_type, status, reference, content, work_id, task_id)
		VALUES (?, ?, 'stock_analysis', 'generating', ?, '', ?, ?)
	`).run(sessionId, `个股分析 (${stock_name})`, JSON.stringify(refObj), workId, taskId);

	return selectStockAnalysisDetail(db, sessionId) as StockAiAnalysis;
}

function selectLatestArticleAnalysis(
	db: ReturnType<typeof getDB>,
	sourceId: string,
	analysisType: ArticleAiAnalysis["analysisType"],
	market: string = "CN"
): ArticleAiAnalysis | undefined {
	const biz_type = analysisType === "verification" ? "fact_check" : "deep_reasoning";
	
	const row = db.prepare(`
		SELECT id, reference, status, content, created_at, updated_at
		FROM agent_sessions
		WHERE biz_type = ?
			AND json_extract(reference, '$.sourceId') = ?
			${analysisType === "deduction" ? "AND json_extract(reference, '$.market_type') = ?" : ""}
		ORDER BY updated_at DESC, created_at DESC
		LIMIT 1
	`).get(...(analysisType === "deduction" ? [biz_type, sourceId, market] : [biz_type, sourceId])) as any;

	if (!row) return undefined;
	const ref = JSON.parse(row.reference || "{}");
	return {
		id: row.id,
		sourceId: ref.sourceId || "",
		analysisType,
		sourceTitle: ref.sourceTitle || "",
		market: ref.market_type || undefined,
		sessionId: row.id,
		status: row.status,
		content: row.content,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
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
			const conditions = ["biz_type = 'stock_analysis'", "json_extract(reference, '$.market_type') = ?"];
			const queryParams: unknown[] = [args.market];
			if (args.stock_code) {
				conditions.push("json_extract(reference, '$.stock_code') = ?");
				queryParams.push(normalizeStockCode(args.stock_code));
			}
			const rows = db.prepare(`
				SELECT id, reference, status, created_at, updated_at
				FROM agent_sessions
				WHERE ${conditions.join(" AND ")}
				ORDER BY updated_at DESC, created_at DESC
				LIMIT ? OFFSET ?
			`).all(...queryParams, args.pageSize, offset) as any[];

			const countRow = db.prepare(`
				SELECT COUNT(*) AS total
				FROM agent_sessions
				WHERE ${conditions.join(" AND ")}
			`).get(...queryParams) as { total: number };
			const total = countRow.total || 0;

			const mappedRows = rows.map(r => mapRowToStockAnalysis(r));

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
		description: "发起个股 AI 分析任务，返回 Agent 消息。",
		parameters: BuildStockAiAnalysisMessageAgentToolSchema,
		registerTool: false,
		async execute(params) {
			const args = BuildStockAiAnalysisMessageParamsSchema.parse(params);
			const db = getDB();
			const stock_code = normalizeStockCode(args.stock_code);
			const generating = selectLatestGeneratingStockAnalysis(db, stock_code, args.market, args.sessionId);
			if (generating) {
				return JSON.stringify({
					success: true,
					skipped: true,
					data: {
						status: generating.status
					}
				});
			}
			const sessionId = args.sessionId || randomUUID();
			const preflightSave = createGeneratingStockAnalysis(db, {
				stock_code,
				stock_name: args.stock_name,
				market: args.market,
				sessionId: sessionId
			});
			const message = buildStockAiAnalysisMessage({ ...args, stock_code, sessionId });
			return JSON.stringify({
				success: true,
				data: {
					status: preflightSave.status,
					message
				}
			});
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
			const biz_type = args.analysisType === "verification" ? "fact_check" : "deep_reasoning";
			const offset = (args.page - 1) * args.pageSize;
			const marketCondition = args.analysisType === "deduction" ? " AND json_extract(reference, '$.market_type') = ?" : "";
			const queryParams = args.analysisType === "deduction"
				? [biz_type, args.market, args.pageSize, offset]
				: [biz_type, args.pageSize, offset];
			const rows = db.prepare(`
				SELECT id, reference, status, created_at, updated_at
				FROM agent_sessions
				WHERE biz_type = ?${marketCondition}
				ORDER BY updated_at DESC, created_at DESC
				LIMIT ? OFFSET ?
			`).all(...queryParams) as any[];

			const countParams = args.analysisType === "deduction" ? [biz_type, args.market] : [biz_type];
			const countRow = db.prepare(`
				SELECT COUNT(*) AS total
				FROM agent_sessions
				WHERE biz_type = ?${marketCondition}
			`).get(...countParams) as { total: number };
			const total = countRow.total || 0;

			const data = rows.map(r => {
				const ref = JSON.parse(r.reference || "{}");
				return {
					id: r.id,
					sourceId: ref.sourceId || "",
					analysisType: args.analysisType,
					sourceTitle: ref.sourceTitle || "",
					market: ref.market_type || undefined,
					sessionId: r.id,
					status: r.status,
					createdAt: r.created_at,
					updatedAt: r.updated_at
				};
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
	}
};
