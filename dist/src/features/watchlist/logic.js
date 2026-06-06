import { randomUUID } from "node:crypto";
import { completeSimple } from "@mariozechner/pi-ai";
import { extractAssistantText, prepareSimpleCompletionModelForAgent } from "openclaw/plugin-sdk/simple-completion-runtime";
import { getDB } from "../../core/database.js";
import { logger } from "../../core/logger.js";
import { StockClassificationSchema } from "../../types.js";
const MAIN_AGENT_ID = "hedgehog-finance";
const SINGLE_CLASSIFICATION_TIMEOUT_MS = 180000;
const SMART_SORT_TIMEOUT_MS = 180000;
const BATCH_CLASSIFICATION_BASE_TIMEOUT_MS = 300000;
const BATCH_CLASSIFICATION_PER_STOCK_TIMEOUT_MS = 30000;
const BATCH_CLASSIFICATION_MAX_TIMEOUT_MS = 600000;
const CLASSIFIER_OUTPUT_BASE_TOKENS = 1000;
const CLASSIFIER_OUTPUT_PER_STOCK_TOKENS = 260;
const CLASSIFIER_OUTPUT_MAX_TOKENS = 4096;
const CLASSIFIER_SYSTEM_PROMPT = [
    "你是一个低延迟股票行业/主题分类器，只能完成当前 JSON 分类任务。",
    "禁止检查、加载、调用或提及任何技能、工具、外部数据源或工作区文件。",
    "禁止输出推理过程、解释、Markdown 或代码块；不要思考展开，只做快速匹配。",
    "只允许根据用户消息中提供的行业/主题分类字典和股票列表输出纯 JSON 数组。"
].join("\n");
function normalizeStockCodeForCache(stock_code, exchange) {
    const code = String(stock_code || "")
        .trim()
        .toUpperCase();
    if (/\.(SH|SS|SZ|HK|US)$/i.test(code)) {
        return code.replace(/\.SS$/i, ".SH");
    }
    switch (exchange) {
        case "SSE":
            return `${code}.SH`;
        case "SZSE":
            return `${code}.SZ`;
        case "HKEX":
            return `${code}.HK`;
        default:
            return code;
    }
}
function legacyStockCodeWithoutSuffix(stock_code) {
    return String(stock_code || "")
        .trim()
        .toUpperCase()
        .replace(/\.(SH|SS|SZ|HK|US)$/i, "");
}
function getCachedClassificationRow(db, stock_code, exchange) {
    const cacheCode = normalizeStockCodeForCache(stock_code, exchange);
    const legacyCode = legacyStockCodeWithoutSuffix(stock_code);
    const stmt = db.prepare(`
		SELECT industry_classification, theme_classification FROM stock_classification_cache
		WHERE stock_code = ? AND exchange = ?
	`);
    return (stmt.get(cacheCode, exchange) || (legacyCode !== cacheCode ? stmt.get(legacyCode, exchange) : undefined));
}
function resolveBatchClassificationTimeoutMs(stockCount) {
    return Math.min(BATCH_CLASSIFICATION_MAX_TIMEOUT_MS, BATCH_CLASSIFICATION_BASE_TIMEOUT_MS + Math.max(0, stockCount - 1) * BATCH_CLASSIFICATION_PER_STOCK_TIMEOUT_MS);
}
function estimateClassifierStockCount(prompt) {
    const codeMatches = prompt.match(/\b\d{6}\.(?:SH|SS|SZ|HK|US)\b/gi);
    return Math.max(1, codeMatches?.length ?? 1);
}
function resolveClassifierOutputMaxTokens(prompt) {
    return Math.min(CLASSIFIER_OUTPUT_MAX_TOKENS, CLASSIFIER_OUTPUT_BASE_TOKENS + estimateClassifierStockCount(prompt) * CLASSIFIER_OUTPUT_PER_STOCK_TOKENS);
}
function normalizeCategoryMatchKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s\u00a0\u3000_\-—–·・,，、/／|｜]+/g, "");
}
function disableClassifierReasoningPayload(payload, model) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return payload;
    const next = { ...payload };
    delete next.reasoning_effort;
    delete next.reasoningEffort;
    if (next.reasoning && typeof next.reasoning === "object" && !Array.isArray(next.reasoning)) {
        next.reasoning = { ...next.reasoning, effort: "none" };
    }
    else {
        delete next.reasoning;
    }
    if (Array.isArray(next.include)) {
        next.include = next.include.filter((item) => !String(item).startsWith("reasoning."));
    }
    const modelInfo = (model && typeof model === "object" ? model : {});
    const provider = String(modelInfo.provider || "").toLowerCase();
    const baseUrl = String(modelInfo.baseUrl || "").toLowerCase();
    const modelId = String(modelInfo.id || "").toLowerCase();
    const isGoogleProvider = provider === "google"
        || provider === "google-vertex"
        || baseUrl.includes("generativelanguage.googleapis.com")
        || baseUrl.includes("aiplatform.googleapis.com");
    const compat = modelInfo.compat && typeof modelInfo.compat === "object"
        ? modelInfo.compat
        : {};
    const thinkingFormat = String(compat.thinkingFormat || "").toLowerCase();
    const config = next.config && typeof next.config === "object" && !Array.isArray(next.config)
        ? { ...next.config }
        : undefined;
    if (config && isGoogleProvider) {
        config.responseMimeType ??= "application/json";
        if (modelId.includes("gemini-3") && modelId.includes("flash")) {
            config.thinkingConfig = { thinkingLevel: "MINIMAL" };
        }
        else if (modelId.includes("gemini-3")) {
            config.thinkingConfig = { thinkingLevel: "LOW" };
        }
        else {
            config.thinkingConfig = { thinkingBudget: 0 };
        }
        next.config = config;
    }
    const usesBooleanThinkingToggle = thinkingFormat === "qwen"
        || thinkingFormat === "qwen-chat-template"
        || thinkingFormat === "zai"
        || provider === "qwen"
        || provider === "modelstudio"
        || provider === "zai"
        || baseUrl.includes("dashscope.aliyuncs.com")
        || baseUrl.includes("api.z.ai")
        || "enable_thinking" in next
        || "chat_template_kwargs" in next;
    if (usesBooleanThinkingToggle) {
        next.enable_thinking = false;
        next.chat_template_kwargs = {
            ...(next.chat_template_kwargs && typeof next.chat_template_kwargs === "object" && !Array.isArray(next.chat_template_kwargs)
                ? next.chat_template_kwargs
                : {}),
            enable_thinking: false
        };
    }
    return next;
}
function extractJsonArray(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const source = fenced?.[1]?.trim() || trimmed;
    const start = source.indexOf("[");
    const end = source.lastIndexOf("]");
    if (start < 0 || end < start) {
        throw new Error("AI 未返回有效分类 JSON");
    }
    const parsed = JSON.parse(source.slice(start, end + 1));
    if (!Array.isArray(parsed)) {
        throw new Error("AI 分类结果不是数组");
    }
    return parsed;
}
export const watchlistLogic = {
    _normalizeStockCodeForCache: normalizeStockCodeForCache,
    async getStockClassification(rt, stock_name, stock_code, exchange, _userId) {
        const db = getDB();
        const cached = getCachedClassificationRow(db, stock_code, exchange);
        if (cached && cached.industry_classification) {
            try {
                return watchlistLogic._normalizeCachedClassification({
                    industry: JSON.parse(cached.industry_classification),
                    theme: JSON.parse(cached.theme_classification || '[]'),
                    weight: 50
                });
            }
            catch (e) {
            }
        }
        const classification = await watchlistLogic._autoClassifyWithAI(rt, stock_name, stock_code, exchange);
        return classification;
    },
    async classifyStocksTogether(rt, stocks, _userId) {
        const db = getDB();
        const results = new Array(stocks.length).fill(null);
        const pendingStocks = [];
        stocks.forEach((stock, idx) => {
            const cached = getCachedClassificationRow(db, stock.stock_code, stock.exchange);
            if (cached && cached.industry_classification) {
                try {
                    results[idx] = watchlistLogic._normalizeCachedClassification({
                        industry: JSON.parse(cached.industry_classification),
                        theme: JSON.parse(cached.theme_classification || '[]'),
                        weight: 50
                    });
                    return;
                }
                catch {
                }
            }
            pendingStocks.push({
                idx,
                stock_name: stock.stock_name,
                stock_code: stock.stock_code,
                exchange: stock.exchange
            });
        });
        if (pendingStocks.length === 0) {
            return results;
        }
        const cats = watchlistLogic._getKnownCategories(db);
        if (cats.industries.length === 0) {
            throw new Error("行业分类字典为空，无法分析行业/主题关系");
        }
        const stocksList = pendingStocks.map(s => `- ${s.stock_name} (${s.stock_code})`).join("\n");
        const prompt = watchlistLogic._buildAiPrompt(cats.industries, cats.themes, stocksList, true);
        const sessionId = `classify-batch-${randomUUID()}`;
        const aiText = await watchlistLogic._callClassifierAi(rt, sessionId, prompt, resolveBatchClassificationTimeoutMs(pendingStocks.length));
        let parsed;
        try {
            parsed = extractJsonArray(aiText);
        }
        catch (e) {
            logger.warn({
                err: e instanceof Error ? e.message : String(e),
                pendingCodes: pendingStocks.map(stock => stock.stock_code),
                aiTextLength: aiText.length,
                aiText
            }, "[Watchlist] batch classification AI parse failed");
            throw e;
        }
        const parsedByCode = new Map();
        parsed.forEach((raw) => {
            if (raw?.code)
                parsedByCode.set(String(raw.code), raw);
        });
        let parsedResults;
        try {
            parsedResults = pendingStocks.map((stock, i) => {
                const raw = parsedByCode.get(String(stock.stock_code)) || parsed[i];
                return {
                    stock,
                    data: watchlistLogic._parseClassification(raw, cats, stock.stock_name || stock.stock_code)
                };
            });
        }
        catch (e) {
            logger.warn({
                err: e instanceof Error ? e.message : String(e),
                pendingCodes: pendingStocks.map(stock => stock.stock_code),
                aiTextLength: aiText.length,
                aiText
            }, "[Watchlist] batch classification AI semantic parse failed");
            throw e;
        }
        for (const { stock, data } of parsedResults) {
            results[stock.idx] = data;
        }
        const missing = stocks.find((_, i) => !results[i]);
        if (missing) {
            throw new Error(`行业/主题关系分析失败: ${missing.stock_name || missing.stock_code}`);
        }
        return results;
    },
    async getBatchStockClassification(rt, stocks, _userId, options = {}) {
        const db = getDB();
        const results = new Array(stocks.length).fill(null);
        const pendingStocks = [];
        stocks.forEach((s, i) => {
            const cached = options.forceRefresh
                ? undefined
                : getCachedClassificationRow(db, s.stock_code, s.exchange);
            if (cached && cached.industry_classification) {
                try {
                    results[i] = watchlistLogic._normalizeCachedClassification({
                        industry: JSON.parse(cached.industry_classification),
                        theme: JSON.parse(cached.theme_classification || '[]'),
                        weight: 50
                    });
                }
                catch (e) {
                    pendingStocks.push({ idx: i, name: s.stock_name, code: s.stock_code, exchange: s.exchange });
                }
            }
            else {
                pendingStocks.push({ idx: i, name: s.stock_name, code: s.stock_code, exchange: s.exchange });
            }
        });
        if (pendingStocks.length > 0) {
            const cats = watchlistLogic._getKnownCategories(db);
            if (cats.industries.length === 0)
                return results;
            const stocksList = pendingStocks.map(s => `- ${s.name} (${s.code})`).join("\n");
            const prompt = watchlistLogic._buildAiPrompt(cats.industries, cats.themes, stocksList, true);
            try {
                const aiText = await watchlistLogic._callClassifierAi(rt, `classify-batch-${randomUUID()}`, prompt, resolveBatchClassificationTimeoutMs(pendingStocks.length));
                const parsed = extractJsonArray(aiText);
                const parsedByCode = new Map();
                parsed.forEach((raw) => {
                    if (raw?.code)
                        parsedByCode.set(String(raw.code), raw);
                });
                const parsedResults = pendingStocks.map((ps, i) => {
                    const raw = parsedByCode.get(String(ps.code)) || parsed[i];
                    return {
                        stock: ps,
                        data: watchlistLogic._parseClassification(raw, cats, ps.name || ps.code)
                    };
                });
                for (const { stock, data } of parsedResults) {
                    results[stock.idx] = data;
                }
            }
            catch (e) {
                logger.error({
                    err: e instanceof Error ? e.message : String(e),
                    pendingCodes: pendingStocks.map(stock => stock.code)
                }, "[Watchlist] batch AI classification failed");
                if (options.requireComplete)
                    throw e;
            }
        }
        if (options.requireComplete) {
            const missing = stocks.find((_, i) => !results[i]);
            if (missing) {
                throw new Error(`行业/主题关系分析失败: ${missing.stock_name || missing.stock_code}`);
            }
        }
        return results;
    },
    _getKnownCategories(db) {
        const industries = db.prepare("SELECT name FROM industry_theme_categories WHERE type = 'industry'").all();
        const themes = db.prepare("SELECT name FROM industry_theme_categories WHERE type = 'theme'").all();
        return {
            industries: industries.map(i => i.name),
            themes: themes.map(t => t.name)
        };
    },
    async _autoClassifyWithAI(rt, stock_name, stock_code, exchange) {
        const db = getDB();
        const cats = watchlistLogic._getKnownCategories(db);
        if (cats.industries.length === 0) {
            return null;
        }
        const prompt = watchlistLogic._buildAiPrompt(cats.industries, cats.themes, `${stock_name} (${stock_code})`, false);
        const aiText = await watchlistLogic._callClassifierAi(rt, `classify-${stock_code}`, prompt, SINGLE_CLASSIFICATION_TIMEOUT_MS);
        try {
            const parsed = extractJsonArray(aiText);
            const raw = parsed[0];
            if (raw) {
                return watchlistLogic._parseClassification(raw, cats, stock_name || stock_code);
            }
        }
        catch (e) {
            logger.warn({ err: e instanceof Error ? e.message : String(e), stock_code, stock_name }, "[Watchlist] AI 分类解析异常");
        }
        return null;
    },
    async _callClassifierCompletion(rt, sessionId, prompt, timeoutMs) {
        const cfg = rt.config.loadConfig();
        const maxTokens = resolveClassifierOutputMaxTokens(prompt);
        const embeddedCfg = {
            ...cfg,
            agents: {
                ...cfg.agents,
                defaults: {
                    ...cfg.agents?.defaults,
                    systemPromptOverride: CLASSIFIER_SYSTEM_PROMPT
                }
            }
        };
        const completionModelParams = {
            cfg: embeddedCfg,
            agentId: MAIN_AGENT_ID,
            allowBundledStaticCatalogFallback: true
        };
        const prepared = await prepareSimpleCompletionModelForAgent(completionModelParams);
        if ("error" in prepared) {
            throw new Error(prepared.error);
        }
        if (!prepared.auth.apiKey) {
            throw new Error(`No API key found for provider "${prepared.selection.provider}".`);
        }
        const abortController = new AbortController();
        const abortTimer = setTimeout(() => {
            abortController.abort(new Error(`classifier completion timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        try {
            const result = await completeSimple(prepared.model, {
                systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
                messages: [{
                        role: "user",
                        content: prompt,
                        timestamp: Date.now()
                    }]
            }, {
                apiKey: prepared.auth.apiKey,
                temperature: 0,
                maxTokens,
                signal: abortController.signal,
                onPayload: disableClassifierReasoningPayload
            });
            const aiText = extractAssistantText(result)?.trim() || "";
            if (!aiText) {
                throw new Error("AI 分类分析未返回内容");
            }
            extractJsonArray(aiText);
            return aiText;
        }
        finally {
            clearTimeout(abortTimer);
        }
    },
    async _callClassifierAi(rt, sessionId, prompt, timeoutMs) {
        try {
            return await watchlistLogic._callClassifierCompletion(rt, sessionId, prompt, timeoutMs);
        }
        catch (e) {
            logger.warn({
                err: e instanceof Error ? e.message : String(e),
                sessionId
            }, "[Watchlist] classifier simple completion failed");
            throw e;
        }
    },
    _ensureCategory(db, name, type, userId) {
        const existing = db.prepare("SELECT id FROM industry_theme_categories WHERE userId = ? AND name = ? AND type = ?").get(userId, name, type);
        if (existing)
            return existing.id;
        const maxOrderRow = db.prepare("SELECT MAX(sortOrder) as max FROM industry_theme_categories WHERE userId = ?").get(userId);
        const nextOrder = (maxOrderRow?.max || 0) + 10;
        const id = randomUUID();
        db.prepare(`INSERT INTO industry_theme_categories (id, userId, name, type, sortOrder, weight) VALUES (?, ?, ?, ?, ?, 0)`).run(id, userId, name, type, nextOrder);
        return id;
    },
    _buildSmartSortPrompt(stocks) {
        return JSON.stringify({
            cw_content: `# 股票智能排序\n## 股票列表\n${JSON.stringify(stocks)}\n## 指令和要求\n根据股票被提及的热度（30%）、总市值（30%）、用户记忆中近两周提及该股票的次数（30%）、最近一周该股票的波动性（10%）进行加权综合排序，总权重（最高100分）高的排在前面。\n`,
            cw_output: `严格按照JSON格式输出：\n\n[\n  { "code": "000000", \n    "name": "xxxx",\n    "weight": 0\n  }\n]\n`
        }, null, 2);
    },
    async applySmartSort(rt, sessionId, stocks) {
        const prompt = watchlistLogic._buildSmartSortPrompt(stocks);
        const aiText = await watchlistLogic._callClassifierAi(rt, `smart-sort-${sessionId}`, prompt, SMART_SORT_TIMEOUT_MS);
        const jsonMatch = aiText.match(/\[.*\]/s);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            }
            catch (e) {
                return [];
            }
        }
        return [];
    },
    _parseClassification(raw, cats, label) {
        if (!raw || !Array.isArray(raw.category)) {
            throw new Error(`行业/主题关系分析失败: ${label}`);
        }
        const industryItem = raw.category.find((c) => cats.industries.includes(watchlistLogic._anchorToCategory(c.name, cats.industries)));
        if (!industryItem) {
            throw new Error(`行业分类分析失败: ${label}`);
        }
        const industryName = watchlistLogic._anchorToCategory(industryItem.name, cats.industries);
        const themesItems = raw.category.filter((c) => c !== industryItem);
        return {
            industry: {
                name: industryName,
                weight: industryItem.weight || 100
            },
            theme: themesItems
                .map((t) => ({
                name: watchlistLogic._anchorToCategory(t.name, cats.themes),
                weight: t.weight || 0
            }))
                .filter((t) => cats.themes.includes(t.name)),
            weight: 50
        };
    },
    _normalizeCachedClassification(value) {
        const parsed = StockClassificationSchema.safeParse(value);
        if (!parsed.success || !parsed.data.industry?.name) {
            throw new Error("缓存分类缺少行业");
        }
        return parsed.data;
    },
    _buildAiPrompt(industries, themes, input, isBatch) {
        let stocksJson = input;
        if (isBatch) {
            const stocks = input.split('\n').filter(line => line.trim()).map(line => {
                const match = line.match(/-\s*(.*?)\s*\((.*?)\)/);
                return match ? { name: match[1], code: match[2] } : null;
            }).filter(Boolean);
            stocksJson = JSON.stringify(stocks);
        }
        else {
            const match = input.match(/(.*?)\s*\((.*?)\)/);
            stocksJson = JSON.stringify([match ? { name: match[1], code: match[2] } : { name: input, code: "" }]);
        }
        return JSON.stringify({
            cw_context: `**行业分类**: [${industries.join(", ")}]\n**主题分类**: [${themes.join(", ")}]\n`,
            cw_content: `# 股票智能分类\n## 股票列表\n${stocksJson}\n## 指令和要求\n根据其基本面和金融市场知识，把上面\`股票列表\`中的每个股票归属的行业分类和主题分类提取出来，并根据相关性给出权重值（0-100的整数，相关性越高分数越高）。\n\`行业分类\`和\`主题分类\`必须在上下文中提供的列表内选择，不得自己创建词汇。每个股票只能且必须选择一个行业分类，每个股票可以选择0～2个主题分类，不是必选的，不要刻意去选择相关性不高的主题分类。\n股票的\`行业分类\`和\`主题分类\`统称为\`分类Category\`，输出时可以放在一个Category数组中。\n`,
            cw_output: `严格按照JSON格式输出：\n\n[\n  { "code": "000000", \n    "name": "xxxx",\n    "category": [{"name": "xxx", "weight": 80}, {"name": "xxx", "weight": 0}]\n  }\n]\n`
        }, null, 2);
    },
    _anchorToCategory(value, categories) {
        if (!value || categories.length === 0)
            return "其他";
        const trimmed = value.trim();
        const exact = categories.find(c => c === trimmed);
        if (exact)
            return exact;
        const normalized = normalizeCategoryMatchKey(trimmed);
        const normalizedExact = categories.find(c => normalizeCategoryMatchKey(c) === normalized);
        if (normalizedExact)
            return normalizedExact;
        const candidates = categories.filter(c => {
            const categoryKey = normalizeCategoryMatchKey(c);
            return c.includes(trimmed)
                || trimmed.includes(c)
                || (normalized.length > 0 && (categoryKey.includes(normalized) || normalized.includes(categoryKey)));
        });
        if (candidates.length === 1)
            return candidates[0];
        return "其他";
    }
};
//# sourceMappingURL=logic.js.map