import { randomUUID } from "node:crypto";
import { completeSimple } from "@mariozechner/pi-ai";
import { PluginRuntime } from "openclaw/plugin-sdk";
import {
	extractAssistantText,
	prepareSimpleCompletionModel
} from "openclaw/plugin-sdk/simple-completion-runtime";
import { getDB } from "../../core/database.js";
import { logger } from "../../core/logger.js";
import { StockClassification, StockClassificationSchema } from "../../types.js";

interface GlobalStockMetadataRow {
	industryJson: string;
	themeJson: string;
	stockName: string;
	lastUpdated: string;
}

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
	"你是一个股票行业/主题分类器，只能完成当前 JSON 分类任务。",
	"禁止检查、加载、调用或提及任何技能、工具、外部数据源或工作区文件。",
	"禁止输出推理过程、解释、Markdown 或代码块。",
	"只允许根据用户消息中提供的行业/主题分类字典和股票列表输出纯 JSON 数组。"
].join("\n");

function resolveModelRef(modelConfig: unknown): string | undefined {
	if (typeof modelConfig === "string" && modelConfig.trim()) return modelConfig.trim();
	if (!modelConfig || typeof modelConfig !== "object" || Array.isArray(modelConfig)) return undefined;
	const primary = (modelConfig as { primary?: unknown }).primary;
	return typeof primary === "string" && primary.trim() ? primary.trim() : undefined;
}

function getConfiguredProviderConfig(cfg: any, provider: string): any | undefined {
	const providerConfigs = cfg.models?.providers;
	if (!providerConfigs) return undefined;
	const exact = providerConfigs[provider];
	if (exact) return exact;
	const normalized = provider.trim().toLowerCase();
	return Object.entries(providerConfigs).find(([key]) => key.trim().toLowerCase() === normalized)?.[1];
}

function resolveClassifierModelSelection(
	cfg: any,
	defaultProvider: string,
	defaultModel: string
): { provider: string; model: string } {
	const agentEntry = ((cfg.agents?.list || []) as any[]).find((agent) => agent?.id === MAIN_AGENT_ID);
	const primary = resolveModelRef(agentEntry?.model)
		|| resolveModelRef(cfg.agents?.defaults?.model)
		|| `${defaultProvider}/${defaultModel}`;
	const slash = primary.indexOf("/");
	if (slash > 0) {
		return {
			provider: primary.slice(0, slash),
			model: primary.slice(slash + 1)
		};
	}
	return {
		provider: defaultProvider,
		model: primary
	};
}

function normalizeStockCodeForCache(stockCode: string, exchange?: string): string {
	const code = String(stockCode || "")
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

function legacyStockCodeWithoutSuffix(stockCode: string): string {
	return String(stockCode || "")
		.trim()
		.toUpperCase()
		.replace(/\.(SH|SS|SZ|HK|US)$/i, "");
}

function getCachedClassificationRow(db: any, stockCode: string, exchange: string): GlobalStockMetadataRow | undefined {
	const cacheCode = normalizeStockCodeForCache(stockCode, exchange);
	const legacyCode = legacyStockCodeWithoutSuffix(stockCode);
	const stmt = db.prepare(`
		SELECT industryJson, themeJson FROM global_stock_metadata
		WHERE stockCode = ? AND exchange = ?
	`);
	return (stmt.get(cacheCode, exchange) || (legacyCode !== cacheCode ? stmt.get(legacyCode, exchange) : undefined)) as GlobalStockMetadataRow | undefined;
}

function resolveBatchClassificationTimeoutMs(stockCount: number): number {
	return Math.min(
		BATCH_CLASSIFICATION_MAX_TIMEOUT_MS,
		BATCH_CLASSIFICATION_BASE_TIMEOUT_MS + Math.max(0, stockCount - 1) * BATCH_CLASSIFICATION_PER_STOCK_TIMEOUT_MS
	);
}

function estimateClassifierStockCount(prompt: string): number {
	const codeMatches = prompt.match(/\b\d{6}\.(?:SH|SS|SZ|HK|US)\b/gi);
	return Math.max(1, codeMatches?.length ?? 1);
}

function resolveClassifierOutputMaxTokens(prompt: string): number {
	return Math.min(
		CLASSIFIER_OUTPUT_MAX_TOKENS,
		CLASSIFIER_OUTPUT_BASE_TOKENS + estimateClassifierStockCount(prompt) * CLASSIFIER_OUTPUT_PER_STOCK_TOKENS
	);
}

function normalizeCategoryMatchKey(value: string): string {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[\s\u00a0\u3000_\-—–·・,，、/／|｜]+/g, "");
}

function disableClassifierReasoningPayload(payload: unknown, model: unknown): unknown {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
	const next = { ...(payload as Record<string, unknown>) };
	delete next.reasoning_effort;
	delete next.reasoningEffort;
	if (next.reasoning && typeof next.reasoning === "object" && !Array.isArray(next.reasoning)) {
		next.reasoning = { ...(next.reasoning as Record<string, unknown>), effort: "none" };
	} else {
		delete next.reasoning;
	}

	const modelInfo = (model && typeof model === "object" ? model : {}) as Record<string, unknown>;
	const provider = String(modelInfo.provider || "").toLowerCase();
	const baseUrl = String(modelInfo.baseUrl || "").toLowerCase();
	const compat = modelInfo.compat && typeof modelInfo.compat === "object"
		? modelInfo.compat as Record<string, unknown>
		: {};
	const thinkingFormat = String(compat.thinkingFormat || "").toLowerCase();
	const usesBooleanThinkingToggle =
		thinkingFormat === "qwen"
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
				? next.chat_template_kwargs as Record<string, unknown>
				: {}),
			enable_thinking: false
		};
	}
	return next;
}

function extractJsonArray(text: string): unknown[] {
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

	async getStockClassification(
		rt: PluginRuntime,
		stockName: string,
		stockCode: string,
		exchange: string,
		_userId: string
	): Promise<StockClassification | null> {
		const db = getDB();

		const cached = getCachedClassificationRow(db, stockCode, exchange);

		if (cached && cached.industryJson) {
			try {
				return watchlistLogic._normalizeCachedClassification({
					industry: JSON.parse(cached.industryJson),
					theme: JSON.parse(cached.themeJson || '[]'),
					weight: 50
				});
			} catch (e) {
			}
		}

		const classification = await watchlistLogic._autoClassifyWithAI(rt, stockName, stockCode, exchange);

		return classification;
	},

	async classifyStocksTogether(
		rt: PluginRuntime,
		stocks: any[],
		_userId: string
	): Promise<StockClassification[]> {
		const db = getDB();
		const results = new Array<StockClassification | null>(stocks.length).fill(null);
		const pendingStocks: { idx: number, stockName: string, stockCode: string, exchange: string }[] = [];

		stocks.forEach((stock, idx) => {
			const cached = getCachedClassificationRow(db, stock.stockCode, stock.exchange);

			if (cached && cached.industryJson) {
				try {
					results[idx] = watchlistLogic._normalizeCachedClassification({
						industry: JSON.parse(cached.industryJson),
						theme: JSON.parse(cached.themeJson || '[]'),
						weight: 50
					});
					return;
				} catch {
				}
			}

			pendingStocks.push({
				idx,
				stockName: stock.stockName,
				stockCode: stock.stockCode,
				exchange: stock.exchange
			});
		});

		if (pendingStocks.length === 0) {
			return results as StockClassification[];
		}

		const cats = watchlistLogic._getKnownCategories(db);
		if (cats.industries.length === 0) {
			throw new Error("行业分类字典为空，无法分析行业/主题关系");
		}

		const stocksList = pendingStocks.map(s => `- ${s.stockName} (${s.stockCode})`).join("\n");
		const prompt = watchlistLogic._buildAiPrompt(cats.industries, cats.themes, stocksList, true);
		const sessionId = `classify-batch-${randomUUID()}`;
		const aiText = await watchlistLogic._callClassifierAi(rt, sessionId, prompt, resolveBatchClassificationTimeoutMs(pendingStocks.length));
		let parsed: unknown[];
		try {
			parsed = extractJsonArray(aiText);
		} catch (e) {
			logger.warn({
				err: e instanceof Error ? e.message : String(e),
				pendingCodes: pendingStocks.map(stock => stock.stockCode),
				aiTextLength: aiText.length,
				aiText
			}, "[Watchlist] batch classification AI parse failed");
			throw e;
		}

		const parsedByCode = new Map<string, any>();
		parsed.forEach((raw: any) => {
			if (raw?.code) parsedByCode.set(String(raw.code), raw);
		});

		let parsedResults: { stock: typeof pendingStocks[number]; data: StockClassification }[];
		try {
			parsedResults = pendingStocks.map((stock, i) => {
				const raw = parsedByCode.get(String(stock.stockCode)) || parsed[i];
				return {
					stock,
					data: watchlistLogic._parseClassification(raw, cats, stock.stockName || stock.stockCode)
				};
			});
		} catch (e) {
			logger.warn({
				err: e instanceof Error ? e.message : String(e),
				pendingCodes: pendingStocks.map(stock => stock.stockCode),
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
			throw new Error(`行业/主题关系分析失败: ${missing.stockName || missing.stockCode}`);
		}
		return results as StockClassification[];
	},

	async getBatchStockClassification(
		rt: PluginRuntime,
		stocks: any[],
		_userId: string,
		options: { requireComplete?: boolean; forceRefresh?: boolean } = {}
	): Promise<(StockClassification | null)[]> {
		const db = getDB();
		const results = new Array(stocks.length).fill(null);
		const pendingStocks: { idx: number, name: string, code: string, exchange: string }[] = [];
		stocks.forEach((s, i) => {
			const cached = options.forceRefresh
				? undefined
				: getCachedClassificationRow(db, s.stockCode, s.exchange);
			if (cached && cached.industryJson) {
				try {
					results[i] = watchlistLogic._normalizeCachedClassification({
						industry: JSON.parse(cached.industryJson),
						theme: JSON.parse(cached.themeJson || '[]'),
						weight: 50
					});
				} catch (e) {
					pendingStocks.push({ idx: i, name: s.stockName, code: s.stockCode, exchange: s.exchange });
				}
			} else {
				pendingStocks.push({ idx: i, name: s.stockName, code: s.stockCode, exchange: s.exchange });
			}
		});
		if (pendingStocks.length > 0) {
			const cats = watchlistLogic._getKnownCategories(db);
			if (cats.industries.length === 0) return results;

			const stocksList = pendingStocks.map(s => `- ${s.name} (${s.code})`).join("\n");
			const prompt = watchlistLogic._buildAiPrompt(cats.industries, cats.themes, stocksList, true);

			try {
				const aiText = await watchlistLogic._callClassifierAi(rt, `classify-batch-${randomUUID()}`, prompt, resolveBatchClassificationTimeoutMs(pendingStocks.length));
				const parsed = extractJsonArray(aiText);
				const parsedByCode = new Map<string, any>();
				parsed.forEach((raw: any) => {
					if (raw?.code) parsedByCode.set(String(raw.code), raw);
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
			} catch (e) {
				logger.error({
					err: e instanceof Error ? e.message : String(e),
					pendingCodes: pendingStocks.map(stock => stock.code)
				}, "[Watchlist] batch AI classification failed");
				if (options.requireComplete) throw e;
			}
		}
		if (options.requireComplete) {
			const missing = stocks.find((_, i) => !results[i]);
			if (missing) {
				throw new Error(`行业/主题关系分析失败: ${missing.stockName || missing.stockCode}`);
			}
		}
		return results;
	},

	_getKnownCategories(db: any) {
		const industries = db.prepare("SELECT name FROM watchlist_categories WHERE type = 'industry'").all() as any[];
		const themes = db.prepare("SELECT name FROM watchlist_categories WHERE type = 'theme'").all() as any[];
		return {
			industries: industries.map(i => i.name),
			themes: themes.map(t => t.name)
		};
	},

	async _autoClassifyWithAI(
		rt: PluginRuntime,
		stockName: string,
		stockCode: string,
		exchange: string
	): Promise<StockClassification | null> {
		const db = getDB();
		const cats = watchlistLogic._getKnownCategories(db);

		if (cats.industries.length === 0) {
			return null;
		}

		const prompt = watchlistLogic._buildAiPrompt(cats.industries, cats.themes, `${stockName} (${stockCode})`, false);
		const aiText = await watchlistLogic._callClassifierAi(rt, `classify-${stockCode}`, prompt, SINGLE_CLASSIFICATION_TIMEOUT_MS);

		try {
			const parsed = extractJsonArray(aiText);
			const raw = parsed[0];
			if (raw) {
				return watchlistLogic._parseClassification(raw, cats, stockName || stockCode);
			}
		} catch (e) {
			logger.warn({ err: e instanceof Error ? e.message : String(e), stockCode, stockName }, "[Watchlist] AI 分类解析异常");
		}
		return null;
	},

	async _callClassifierCompletion(rt: PluginRuntime, sessionId: string, prompt: string, timeoutMs: number): Promise<string> {
		const cfg = rt.config.loadConfig();
		const { provider, model } = resolveClassifierModelSelection(cfg, rt.agent.defaults.provider, rt.agent.defaults.model);
		const maxTokens = resolveClassifierOutputMaxTokens(prompt);
		const providerAuth = await rt.modelAuth.resolveApiKeyForProvider({ provider, cfg });
		if (!providerAuth.apiKey) {
			throw new Error(`No API key found for provider "${provider}".`);
		}
		const providerConfigs = cfg.models?.providers;
		const providerConfig = getConfiguredProviderConfig(cfg, provider);
		if (!providerConfig) {
			throw new Error(`No model provider config found for "${provider}".`);
		}
		const embeddedCfg = {
			...cfg,
			agents: {
				...cfg.agents,
				defaults: {
					...cfg.agents?.defaults,
					systemPromptOverride: CLASSIFIER_SYSTEM_PROMPT
				}
			},
			models: {
				...cfg.models,
				providers: {
					...providerConfigs,
					[provider]: {
						...providerConfig,
						auth: "api-key" as const,
						apiKey: providerAuth.apiKey
					}
				}
			}
		};
		const prepared = await prepareSimpleCompletionModel({
			cfg: embeddedCfg,
			provider,
			modelId: model
		});
		if ("error" in prepared) {
			throw new Error(prepared.error);
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
		} finally {
			clearTimeout(abortTimer);
		}
	},

	async _callClassifierAi(rt: PluginRuntime, sessionId: string, prompt: string, timeoutMs: number): Promise<string> {
		try {
			return await watchlistLogic._callClassifierCompletion(rt, sessionId, prompt, timeoutMs);
		} catch (e) {
			logger.warn({
				err: e instanceof Error ? e.message : String(e),
				sessionId
			}, "[Watchlist] classifier simple completion failed");
			throw e;
		}
	},

	_ensureCategory(db: any, name: string, type: 'industry' | 'theme', userId: string): string {
		const existing = db.prepare("SELECT id FROM watchlist_categories WHERE userId = ? AND name = ? AND type = ?").get(userId, name, type) as { id: string } | undefined;
		if (existing) return existing.id;
		const maxOrderRow = db.prepare("SELECT MAX(sortOrder) as max FROM watchlist_categories WHERE userId = ?").get(userId) as { max: number } | undefined;
		const nextOrder = (maxOrderRow?.max || 0) + 10;
		const id = randomUUID();
		db.prepare(`INSERT INTO watchlist_categories (id, userId, name, type, sortOrder, weight) VALUES (?, ?, ?, ?, ?, 0)`).run(id, userId, name, type, nextOrder);
		return id;
	},

	_buildSmartSortPrompt(stocks: { name: string, code: string }[]): string {
		return JSON.stringify({
			cw_content: `# 股票智能排序\n## 股票列表\n${JSON.stringify(stocks)}\n## 指令和要求\n根据股票被提及的热度（30%）、总市值（30%）、用户记忆中近两周提及该股票的次数（30%）、最近一周该股票的波动性（10%）进行加权综合排序，总权重（最高100分）高的排在前面。\n`,
			cw_output: `严格按照JSON格式输出：\n\n[\n  { "code": "000000", \n    "name": "xxxx",\n    "weight": 0\n  }\n]\n`
		}, null, 2);
	},

	async applySmartSort(rt: PluginRuntime, sessionId: string, stocks: { name: string, code: string }[]): Promise<any[]> {
		const prompt = watchlistLogic._buildSmartSortPrompt(stocks);
		const aiText = await watchlistLogic._callClassifierAi(rt, `smart-sort-${sessionId}`, prompt, SMART_SORT_TIMEOUT_MS);
		const jsonMatch = aiText.match(/\[.*\]/s);
		if (jsonMatch) {
			try { return JSON.parse(jsonMatch[0]); } catch (e) { return []; }
		}
		return [];
	},

	_parseClassification(raw: any, cats: { industries: string[]; themes: string[] }, label: string): StockClassification {
		if (!raw || !Array.isArray(raw.category)) {
			throw new Error(`行业/主题关系分析失败: ${label}`);
		}
		const industryItem = raw.category.find((c: any) => cats.industries.includes(watchlistLogic._anchorToCategory(c.name, cats.industries)));
		if (!industryItem) {
			throw new Error(`行业分类分析失败: ${label}`);
		}
		const industryName = watchlistLogic._anchorToCategory(industryItem.name, cats.industries);
		const themesItems = raw.category.filter((c: any) => c !== industryItem);
		return {
			industry: {
				name: industryName,
				weight: industryItem.weight || 100
			},
			theme: themesItems
				.map((t: any) => ({
					name: watchlistLogic._anchorToCategory(t.name, cats.themes),
					weight: t.weight || 0
				}))
				.filter((t: { name: string; weight: number }) => cats.themes.includes(t.name)),
			weight: 50
		};
	},

	_normalizeCachedClassification(value: StockClassification): StockClassification {
		const parsed = StockClassificationSchema.safeParse(value);
		if (!parsed.success || !parsed.data.industry?.name) {
			throw new Error("缓存分类缺少行业");
		}
		return parsed.data;
	},

	_buildAiPrompt(industries: string[], themes: string[], input: string, isBatch: boolean): string {
		let stocksJson = input;
		if (isBatch) {
			const stocks = input.split('\n').filter(line => line.trim()).map(line => {
				const match = line.match(/-\s*(.*?)\s*\((.*?)\)/);
				return match ? { name: match[1], code: match[2] } : null;
			}).filter(Boolean);
			stocksJson = JSON.stringify(stocks);
		} else {
			const match = input.match(/(.*?)\s*\((.*?)\)/);
			stocksJson = JSON.stringify([match ? { name: match[1], code: match[2] } : { name: input, code: "" }]);
		}
		return JSON.stringify({
			cw_context: `**行业分类**: [${industries.join(", ")}]\n**主题分类**: [${themes.join(", ")}]\n`,
			cw_content: `# 股票智能分类\n## 股票列表\n${stocksJson}\n## 指令和要求\n根据其基本面和金融市场知识，把上面\`股票列表\`中的每个股票归属的行业分类和主题分类提取出来，并根据相关性给出权重值（0-100的整数，相关性越高分数越高）。\n\`行业分类\`和\`主题分类\`必须在上下文中提供的列表内选择，不得自己创建词汇。每个股票只能且必须选择一个行业分类，每个股票可以选择0～2个主题分类，不是必选的，不要刻意去选择相关性不高的主题分类。\n股票的\`行业分类\`和\`主题分类\`统称为\`分类Category\`，输出时可以放在一个Category数组中。\n`,
			cw_output: `严格按照JSON格式输出：\n\n[\n  { "code": "000000", \n    "name": "xxxx",\n    "category": [{"name": "xxx", "weight": 80}, {"name": "xxx", "weight": 0}]\n  }\n]\n`
		}, null, 2);
	},

	_anchorToCategory(value: string, categories: string[]): string {
		if (!value || categories.length === 0) return "其他";
		const trimmed = value.trim();
		const exact = categories.find(c => c === trimmed);
		if (exact) return exact;
		const normalized = normalizeCategoryMatchKey(trimmed);
		const normalizedExact = categories.find(c => normalizeCategoryMatchKey(c) === normalized);
		if (normalizedExact) return normalizedExact;
		const candidates = categories.filter(c => {
			const categoryKey = normalizeCategoryMatchKey(c);
			return c.includes(trimmed)
				|| trimmed.includes(c)
				|| (normalized.length > 0 && (categoryKey.includes(normalized) || normalized.includes(categoryKey)));
		});
		if (candidates.length === 1) return candidates[0];
		return "其他";
	}
};
