import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import { CHART_OUTPUT_GUIDANCE, ensureChartPlaceholdersInBody } from "../chartOutput.js";
import { BuildStockAiAnalysisMessageAgentToolSchema, BuildStockAiAnalysisMessageParamsSchema, GetArticleAiAnalysisParamsSchema, GetStockAiAnalysisDetailBySessionParamsSchema, GetStockAiAnalysisDetailParamsSchema, GetStockAiAnalysisParamsSchema, QueryArticleAiAnalysisHistoryParamsSchema, QueryStockAiAnalysisStocksParamsSchema, QueryStockAiAnalysisHistoryParamsSchema, SaveStockAiAnalysisParamsSchema } from "./schema.js";
const STOCK_AI_ANALYSIS_SKILL = "hedgehog-stock-research";
export function normalizeStockCode(stock_code) {
    return stock_code.trim().toUpperCase().replace(/\.SS$/i, ".SH");
}
function buildStockAiAnalysisContent(args) {
    return [
        `分析一下${args.stock_name}股票`,
        "",
        `股票代码：${normalizeStockCode(args.stock_code)}`,
        `股票名称：${args.stock_name}`,
        `市场：${args.market}`
    ].join("\n");
}
function buildStockAiAnalysisMessage(args) {
    const stock_code = normalizeStockCode(args.stock_code);
    const sessionId = args.sessionId || "";
    const buildFinalSaveParams = (status) => JSON.stringify({
        stock_code,
        stock_name: args.stock_name,
        market: args.market,
        sessionId,
        status,
        content: "..."
    });
    return JSON.stringify({
        cw_system_prompt: [
            `第 1 步：必须触发并使用 ${STOCK_AI_ANALYSIS_SKILL} skill 生成个股 AI 分析报告。`,
            `第 2 步：生成成功后必须调用 save_stock_ai_analysis，参数为 ${buildFinalSaveParams("completed")}，content 传最终完整个股分析正文。`,
            `失败处理：任一步失败后必须调用 save_stock_ai_analysis，参数为 ${buildFinalSaveParams("failed")}，content 存放完整错误信息。`,
            "如果最终内容包含 [图表数据]，正文必须已经包含所有对应图表占位符。"
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
function selectLatestStockAnalysis(db, stock_code, market) {
    return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE stock_code = ? AND market = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(stock_code, market);
}
function selectLatestGeneratingStockAnalysis(db, stock_code, market, sessionId) {
    const normalizedSessionId = sessionId?.trim() || "";
    if (normalizedSessionId) {
        const bySession = db.prepare(`
			SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
			FROM stock_ai_analysis
			WHERE stock_code = ? AND market = ? AND sessionId = ? AND status = 'generating'
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(stock_code, market, normalizedSessionId);
        if (bySession)
            return bySession;
    }
    return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE stock_code = ? AND market = ? AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(stock_code, market);
}
function selectStockAnalysisForUpdate(db, stock_code, market, sessionId) {
    if (sessionId) {
        const bySession = db.prepare(`
			SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
			FROM stock_ai_analysis
			WHERE stock_code = ? AND market = ? AND sessionId = ?
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(stock_code, market, sessionId);
        if (bySession)
            return bySession;
    }
    return selectLatestGeneratingStockAnalysis(db, stock_code, market);
}
function selectStockAnalysisDetail(db, id) {
    return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE id = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(id);
}
function selectStockAnalysisDetailBySession(db, sessionId, stock_code) {
    return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE sessionId = ? AND stock_code = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(sessionId, stock_code);
}
function queryStockAnalysisStocks(db, market, page, pageSize) {
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
	`).all(market, pageSize, offset);
    const countRow = db.prepare(`
		SELECT COUNT(*) AS total
		FROM (
			SELECT 1
			FROM stock_ai_analysis
			WHERE market = ?
			GROUP BY stock_code, market
		)
	`).get(market);
    return { rows, total: countRow.total || 0 };
}
export function saveStockAiAnalysisRecord(db, args) {
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
        return selectStockAnalysisDetail(db, existing.id);
    }
    db.prepare(`
		INSERT INTO stock_ai_analysis (id, userId, stock_code, stock_name, market, sessionId, status, content)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`).run(id, "default", stock_code, stock_name, args.market, sessionId, status, content);
    return db.prepare(`
		SELECT id, stock_code, stock_name, market, sessionId, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE id = ?
	`).get(id);
}
function tableForArticleAnalysis(analysisType) {
    return analysisType === "verification" ? "news_fact_check_analysis" : "news_deep_reasoning_analysis";
}
function selectLatestArticleAnalysis(db, sourceId, analysisType, market = "CN") {
    const table = tableForArticleAnalysis(analysisType);
    if (analysisType === "deduction") {
        return db.prepare(`
			SELECT id, sourceId, ? AS analysisType, sourceTitle, market, sessionId, status, content, createdAt, updatedAt
			FROM ${table}
			WHERE sourceId = ? AND market = ?
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(analysisType, sourceId, market);
    }
    return db.prepare(`
		SELECT id, sourceId, ? AS analysisType, sourceTitle, sessionId, status, content, createdAt, updatedAt
		FROM ${table}
		WHERE sourceId = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(analysisType, sourceId);
}
export const stockAnalysisTools = {
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
            const queryParams = [args.market];
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
			`).get(...queryParams);
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
            const data = selectStockAnalysisDetailBySession(db, args.sessionId, normalizeStockCode(args.stock_code));
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
            const preflightSave = saveStockAiAnalysisRecord(db, {
                stock_code,
                stock_name: args.stock_name,
                market: args.market,
                sessionId: args.sessionId || "",
                status: "generating",
                content: ""
            });
            const message = buildStockAiAnalysisMessage({ ...args, stock_code });
            return JSON.stringify({
                success: true,
                data: {
                    status: preflightSave.status,
                    message
                }
            });
        }
    },
    save_stock_ai_analysis: {
        name: "save_stock_ai_analysis",
        description: "保存个股 AI 分析结果。任务派发工具通常已预先保存 status=generating；Agent 生成成功后以 status=completed 保存完整正文 content，生成失败后以 status=failed 保存完整错误信息。status=generating 仅用于兼容直接预占位调用。",
        parameters: SaveStockAiAnalysisParamsSchema,
        registerTool: true,
        async execute(params) {
            const args = SaveStockAiAnalysisParamsSchema.parse(params);
            const db = getDB();
            if (args.status === "generating") {
                const stock_code = normalizeStockCode(args.stock_code);
                const generating = selectLatestGeneratingStockAnalysis(db, stock_code, args.market, args.sessionId);
                if (generating) {
                    return JSON.stringify({ success: true, skipped: true, reason: "already_generating", data: generating });
                }
            }
            const data = saveStockAiAnalysisRecord(db, args);
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
			`).get(...countParams);
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
//# sourceMappingURL=tools.js.map