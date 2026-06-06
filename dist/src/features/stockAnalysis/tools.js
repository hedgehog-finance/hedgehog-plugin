import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import { CHART_OUTPUT_GUIDANCE, ensureChartPlaceholdersInBody } from "../chartOutput.js";
import { BuildStockAiAnalysisMessageParamsSchema, GetArticleAiAnalysisParamsSchema, GetStockAiAnalysisDetailParamsSchema, GetStockAiAnalysisParamsSchema, QueryArticleAiAnalysisHistoryParamsSchema, QueryStockAiAnalysisStocksParamsSchema, SaveArticleDeepReasoningParamsSchema, QueryStockAiAnalysisHistoryParamsSchema, SaveArticleAiAnalysisParamsSchema, SaveStockAiAnalysisParamsSchema } from "./schema.js";
const STOCK_AI_ANALYSIS_SKILL = "hedgehog-stock-research";
const BuildStockAiAnalysisMessageAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    required: ["stock_code", "stock_name"],
    properties: {
        stock_code: { type: "string", description: "股票代码" },
        stock_name: { type: "string", description: "股票名称" },
        market: { type: "string", description: "市场类型，默认 CN" }
    }
};
export function normalizeStockCode(stock_code) {
    return stock_code.trim().toUpperCase().replace(/\.SS$/i, ".SH");
}
function resolveToolUserId(ctx) {
    return ctx?.userId || "default";
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
    const buildGeneratingSaveParams = () => JSON.stringify({
        stock_code,
        stock_name: args.stock_name,
        market: args.market,
        status: "generating",
        content: ""
    });
    const buildFinalSaveParams = (status) => JSON.stringify({
        stock_code,
        stock_name: args.stock_name,
        market: args.market,
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
function selectLatestStockAnalysis(db, stock_code, market) {
    return db.prepare(`
		SELECT id, stock_code, stock_name, market, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE stock_code = ? AND market = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(stock_code, market);
}
function selectLatestGeneratingStockAnalysis(db, userId, stock_code, market) {
    return db.prepare(`
		SELECT id, stock_code, stock_name, market, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE userId = ? AND stock_code = ? AND market = ? AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(userId, stock_code, market);
}
function selectStockAnalysisDetail(db, id) {
    return db.prepare(`
		SELECT id, stock_code, stock_name, market, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE id = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(id);
}
function queryStockAnalysisStocks(db, userId, market, page, pageSize) {
    const offset = (page - 1) * pageSize;
    const rows = db.prepare(`
		WITH grouped AS (
			SELECT
				stock_code,
				market,
				COUNT(*) AS analysisCount,
				MAX(updatedAt || '|' || createdAt || '|' || id) AS latestKey
			FROM stock_ai_analysis
			WHERE userId = ? AND market = ?
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
		WHERE a.userId = ?
		ORDER BY a.updatedAt DESC, a.createdAt DESC
		LIMIT ? OFFSET ?
	`).all(userId, market, userId, pageSize, offset);
    const countRow = db.prepare(`
		SELECT COUNT(*) AS total
		FROM (
			SELECT 1
			FROM stock_ai_analysis
			WHERE userId = ? AND market = ?
			GROUP BY stock_code, market
		)
	`).get(userId, market);
    return { rows, total: countRow.total || 0 };
}
export function saveStockAiAnalysisRecord(db, userId, args) {
    const stock_code = normalizeStockCode(args.stock_code);
    const status = args.status || "completed";
    const stock_name = args.stock_name?.trim() || stock_code;
    const content = status === "completed" ? ensureChartPlaceholdersInBody(args.content) : args.content.trim();
    const id = randomUUID();
    const generating = status === "generating"
        ? undefined
        : selectLatestGeneratingStockAnalysis(db, userId, stock_code, args.market);
    if (generating) {
        db.prepare(`
			UPDATE stock_ai_analysis
			SET status = ?,
				content = ?,
				updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
			WHERE id = ? AND userId = ?
		`).run(status, content, generating.id, userId);
        return selectStockAnalysisDetail(db, generating.id);
    }
    db.prepare(`
		INSERT INTO stock_ai_analysis (id, userId, stock_code, stock_name, market, status, content)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`).run(id, userId, stock_code, stock_name, args.market, status, content);
    return db.prepare(`
		SELECT id, stock_code, stock_name, market, status, content, createdAt, updatedAt
		FROM stock_ai_analysis
		WHERE userId = ? AND id = ?
	`).get(userId, id);
}
function tableForArticleAnalysis(analysisType) {
    return analysisType === "verification" ? "news_fact_check_analysis" : "news_deep_reasoning_analysis";
}
function selectLatestArticleAnalysis(db, userId, sourceId, analysisType, market = "CN") {
    const table = tableForArticleAnalysis(analysisType);
    if (analysisType === "deduction") {
        return db.prepare(`
			SELECT id, sourceId, ? AS analysisType, sourceTitle, market, status, content, createdAt, updatedAt
			FROM ${table}
			WHERE userId = ? AND sourceId = ? AND market = ?
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(analysisType, userId, sourceId, market);
    }
    return db.prepare(`
		SELECT id, sourceId, ? AS analysisType, sourceTitle, status, content, createdAt, updatedAt
		FROM ${table}
		WHERE userId = ? AND sourceId = ?
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(analysisType, userId, sourceId);
}
function selectLatestGeneratingArticleAnalysis(db, userId, sourceId, analysisType) {
    const table = tableForArticleAnalysis(analysisType);
    if (analysisType === "deduction") {
        return db.prepare(`
			SELECT id, sourceId, ? AS analysisType, sourceTitle, market, status, content, createdAt, updatedAt
			FROM ${table}
			WHERE userId = ? AND sourceId = ? AND status = 'generating'
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT 1
		`).get(analysisType, userId, sourceId);
    }
    return db.prepare(`
		SELECT id, sourceId, ? AS analysisType, sourceTitle, status, content, createdAt, updatedAt
		FROM ${table}
		WHERE userId = ? AND sourceId = ? AND status = 'generating'
		ORDER BY updatedAt DESC, createdAt DESC
		LIMIT 1
	`).get(analysisType, userId, sourceId);
}
function saveArticleAiAnalysisRecord(db, userId, args) {
    const id = randomUUID();
    db.prepare(`
		INSERT INTO news_fact_check_analysis (id, sourceId, sourceTitle, userId, status, content)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(sourceId, userId) DO UPDATE SET
			sourceTitle = CASE WHEN excluded.sourceTitle != '' THEN excluded.sourceTitle ELSE news_fact_check_analysis.sourceTitle END,
			status = excluded.status,
			content = excluded.content,
			updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
	`).run(id, args.sourceId, args.sourceTitle, userId, args.status, args.content);
    return db.prepare(`
		SELECT id, sourceId, 'verification' AS analysisType, sourceTitle, status, content, createdAt, updatedAt
		FROM news_fact_check_analysis
		WHERE userId = ? AND sourceId = ?
	`).get(userId, args.sourceId);
}
function saveArticleDeepReasoningRecord(db, userId, args) {
    const id = randomUUID();
    db.prepare(`
		INSERT INTO news_deep_reasoning_analysis (id, sourceId, sourceTitle, userId, market, status, content)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(sourceId, userId, market) DO UPDATE SET
			sourceTitle = CASE WHEN excluded.sourceTitle != '' THEN excluded.sourceTitle ELSE news_deep_reasoning_analysis.sourceTitle END,
			status = excluded.status,
			content = excluded.content,
			updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
	`).run(id, args.sourceId, args.sourceTitle, userId, args.market, args.status, args.content);
    return db.prepare(`
		SELECT id, sourceId, 'deduction' AS analysisType, sourceTitle, market, status, content, createdAt, updatedAt
		FROM news_deep_reasoning_analysis
		WHERE userId = ? AND sourceId = ? AND market = ?
	`).get(userId, args.sourceId, args.market);
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
            const conditions = ["userId = ?", "market = ?"];
            const queryParams = [resolveToolUserId(ctx), args.market];
            if (args.stock_code) {
                conditions.push("stock_code = ?");
                queryParams.push(normalizeStockCode(args.stock_code));
            }
            const rows = db.prepare(`
				SELECT id, stock_code, stock_name, market, status, createdAt, updatedAt
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
        description: "分页查询当前用户所有已经产生过个股 AI 分析记录的股票列表。按股票代码和市场去重，返回每只股票最近一次分析记录 ID、最近状态、最近更新时间和累计分析次数；不返回分析正文 content。",
        parameters: QueryStockAiAnalysisStocksParamsSchema,
        registerTool: false,
        async execute(params, ctx) {
            const args = QueryStockAiAnalysisStocksParamsSchema.parse(params ?? {});
            const db = getDB();
            const { rows, total } = queryStockAnalysisStocks(db, resolveToolUserId(ctx), args.market, args.page, args.pageSize);
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
    build_stock_ai_analysis_message: {
        name: "build_stock_ai_analysis_message",
        label: "构建个股分析消息",
        description: "根据股票代码、名称和市场构建用于主动 RPC 发起 Agent 个股 AI 分析任务的标准消息。该工具只返回提示词消息体，不触发定时任务，也不保存分析结果。",
        parameters: BuildStockAiAnalysisMessageAgentToolSchema,
        registerTool: false,
        async execute(params, ctx) {
            const args = BuildStockAiAnalysisMessageParamsSchema.parse(params);
            const db = getDB();
            const userId = resolveToolUserId(ctx);
            const stock_code = normalizeStockCode(args.stock_code);
            const generating = selectLatestGeneratingStockAnalysis(db, userId, stock_code, args.market);
            if (generating) {
                return JSON.stringify({
                    success: true,
                    skipped: true,
                    reason: "already_generating",
                    data: generating
                });
            }
            const message = buildStockAiAnalysisMessage({ ...args, stock_code });
            return JSON.stringify({
                success: true,
                data: {
                    message,
                    payload: JSON.parse(message),
                    stock_code,
                    saveParams: {
                        stock_code,
                        stock_name: args.stock_name,
                        market: args.market
                    },
                    skill: STOCK_AI_ANALYSIS_SKILL
                }
            });
        }
    },
    save_stock_ai_analysis: {
        name: "save_stock_ai_analysis",
        description: [
            "保存个股 AI 分析结果。生成前必须先以 status=generating、content=\"\" 调用，并传入 stock_code、stock_name、market；生成成功后以 status=completed 保存完整正文 content；生成失败后以 status=failed 保存完整错误信息。",
            "个股分析的 cw_output 需要包含图表相关要求：",
            CHART_OUTPUT_GUIDANCE
        ].join("\n"),
        parameters: SaveStockAiAnalysisParamsSchema,
        registerTool: true,
        async execute(params, ctx) {
            const args = SaveStockAiAnalysisParamsSchema.parse(params);
            const db = getDB();
            const userId = resolveToolUserId(ctx);
            if (args.status === "generating") {
                const stock_code = normalizeStockCode(args.stock_code);
                const generating = selectLatestGeneratingStockAnalysis(db, userId, stock_code, args.market);
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
            const data = selectLatestArticleAnalysis(db, resolveToolUserId(ctx), args.sourceId, args.analysisType, args.market);
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
            const userId = resolveToolUserId(ctx);
            const table = tableForArticleAnalysis(args.analysisType);
            const offset = (args.page - 1) * args.pageSize;
            const marketCondition = args.analysisType === "deduction" ? " AND market = ?" : "";
            const queryParams = args.analysisType === "deduction"
                ? [args.analysisType, userId, args.market, args.pageSize, offset]
                : [args.analysisType, userId, args.pageSize, offset];
            const rows = db.prepare(`
				SELECT id, sourceId, ? AS analysisType, sourceTitle, ${args.analysisType === "deduction" ? "market," : ""} status, createdAt, updatedAt
				FROM ${table}
				WHERE userId = ?${marketCondition}
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT ? OFFSET ?
			`).all(...queryParams);
            const countParams = args.analysisType === "deduction" ? [userId, args.market] : [userId];
            const countRow = db.prepare(`
				SELECT COUNT(*) AS total
				FROM ${table}
				WHERE userId = ?${marketCondition}
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
    },
    save_information_verification: {
        name: "save_information_verification",
        description: "保存新闻信息求证结果。生成前必须先以 status=generating、content=\"\" 调用，并传入 sourceId、sourceTitle；生成成功后以 status=completed 保存完整正文 content；生成失败后以 status=failed 保存完整错误信息。",
        parameters: SaveArticleAiAnalysisParamsSchema,
        registerTool: true,
        async execute(params, ctx) {
            const args = SaveArticleAiAnalysisParamsSchema.parse(params);
            const db = getDB();
            const userId = resolveToolUserId(ctx);
            if (args.status === "generating") {
                const generating = selectLatestGeneratingArticleAnalysis(db, userId, args.sourceId, "verification");
                if (generating) {
                    return JSON.stringify({ success: true, skipped: true, reason: "already_generating", data: generating });
                }
            }
            const data = saveArticleAiAnalysisRecord(db, userId, args);
            return JSON.stringify({ success: true, data });
        }
    },
    save_article_deep_reasoning_analysis: {
        name: "save_article_deep_reasoning_analysis",
        description: "保存新闻深度推演结果。生成前必须先以 status=generating、content=\"\" 调用，并传入 sourceId、sourceTitle、sourceContent、market；生成成功后以 status=completed 保存完整正文 content；生成失败后以 status=failed 保存完整错误信息。",
        parameters: SaveArticleDeepReasoningParamsSchema,
        registerTool: true,
        async execute(params, ctx) {
            const args = SaveArticleDeepReasoningParamsSchema.parse(params);
            const db = getDB();
            const userId = resolveToolUserId(ctx);
            if (args.status === "generating") {
                const generating = selectLatestGeneratingArticleAnalysis(db, userId, args.sourceId, "deduction");
                if (generating) {
                    return JSON.stringify({ success: true, skipped: true, reason: "already_generating", data: generating });
                }
            }
            const data = saveArticleDeepReasoningRecord(db, userId, args);
            return JSON.stringify({ success: true, data });
        }
    }
};
//# sourceMappingURL=tools.js.map