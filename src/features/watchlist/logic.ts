import { randomUUID } from "node:crypto";
import path from "node:path";
import { PluginRuntime } from "openclaw/plugin-sdk";
import { getDB } from "../../core/database";
import { StockClassification, StockClassificationSchema } from "../../types";

interface GlobalStockMetadataRow {
	industryJson: string;
	themeJson: string;
	stockName: string;
	lastUpdated: string;
}

/**
 * 智能分类元数据引擎
 */
export const watchlistLogic = {
	/**
	 * 获取单只股票的分类与权重（带全局缓存）
	 */
	async getStockClassification(
		rt: PluginRuntime,
		stockName: string,
		stockCode: string,
		exchange: string,
		_userId: string
	): Promise<StockClassification | null> {
		const db = getDB();

		// 1. 尝试从全局缓存读取
		const cached = db.prepare(`
			SELECT industryJson, themeJson FROM global_stock_metadata 
			WHERE stockCode = ? AND exchange = ?
		`).get(stockCode, exchange) as GlobalStockMetadataRow | undefined;

		if (cached && cached.industryJson) {
			try {
				return {
					industry: JSON.parse(cached.industryJson),
					theme: JSON.parse(cached.themeJson || '[]'),
					weight: 50
				};
			} catch (e) {
				// 容错
			}
		}

		// 2. 缓存未命中，调用 AI 进行推断
		const classification = await watchlistLogic._autoClassifyWithAI(rt, stockName, stockCode, exchange);

		if (classification) {
			// 3. 结果存入全局缓存
			db.prepare(`
				INSERT OR REPLACE INTO global_stock_metadata (stockCode, exchange, stockName, industryJson, themeJson)
				VALUES (?, ?, ?, ?, ?)
			`).run(
				stockCode,
				exchange,
				stockName,
				JSON.stringify(classification.industry),
				JSON.stringify(classification.theme)
			);
			return classification;
		}

		return null;
	},

	/**
	 * 批量获取股票分类
	 */
	async getBatchStockClassification(
		rt: PluginRuntime,
		stocks: any[],
		_userId: string
	): Promise<(StockClassification | null)[]> {
		const db = getDB();
		const results = new Array(stocks.length).fill(null);
		const pendingStocks: { idx: number, name: string, code: string, exchange: string }[] = [];

		stocks.forEach((s, i) => {
			const cached = db.prepare(`SELECT industryJson, themeJson FROM global_stock_metadata WHERE stockCode = ? AND exchange = ?`).get(s.stockCode, s.exchange) as GlobalStockMetadataRow | undefined;
			if (cached && cached.industryJson) {
				try {
					results[i] = {
						industry: JSON.parse(cached.industryJson),
						theme: JSON.parse(cached.themeJson || '[]'),
						weight: 50
					};
				} catch (e) {
					pendingStocks.push({ idx: i, name: s.stockName, code: s.stockCode, exchange: s.exchange });
				}
			} else {
				pendingStocks.push({ idx: i, name: s.stockName, code: s.stockCode, exchange: s.exchange });
			}
		});

		if (pendingStocks.length > 0) {
			const CHUNK_SIZE = 5;
			const chunks: (typeof pendingStocks)[] = [];
			for (let i = 0; i < pendingStocks.length; i += CHUNK_SIZE) {
				chunks.push(pendingStocks.slice(i, i + CHUNK_SIZE));
			}

			const cats = watchlistLogic._getKnownCategories(db);
			if (cats.industries.length === 0) return results;

			await Promise.all(chunks.map(async (chunk) => {
				const stocksList = chunk.map(s => `- ${s.name} (${s.code})`).join("\n");
				const prompt = watchlistLogic._buildAiPrompt(cats.industries, cats.themes, stocksList, true);

				try {
					const aiText = await watchlistLogic._callEmbeddedAi(rt, `classify-batch-${chunk[0].code}`, prompt, 120000);
					const jsonMatch = aiText.match(/\[.*\]/s);
					if (jsonMatch) {
						const parsed = JSON.parse(jsonMatch[0]);
						chunk.forEach((ps, i) => {
							const raw = parsed[i];
							if (raw && Array.isArray(raw.category)) {
								const industryItem = raw.category.find((c: any) => cats.industries.includes(watchlistLogic._anchorToCategory(c.name, cats.industries)));
								const themesItems = raw.category.filter((c: any) => c !== industryItem);

								if (industryItem) {
									const data: StockClassification = {
										industry: {
											name: watchlistLogic._anchorToCategory(industryItem.name, cats.industries),
											weight: industryItem.weight || 100
										},
										theme: themesItems.map((t: any) => ({
											name: watchlistLogic._anchorToCategory(t.name, cats.themes),
											weight: t.weight || 0
										})),
										weight: 50
									};
									results[ps.idx] = data;
									db.prepare(`INSERT OR REPLACE INTO global_stock_metadata (stockCode, exchange, stockName, industryJson, themeJson) VALUES (?, ?, ?, ?, ?)`)
										.run(ps.code, ps.exchange, ps.name, JSON.stringify(data.industry), JSON.stringify(data.theme));
								}
							}
						});
					}
				} catch (e) {
					console.error(`[Watchlist] 分块 AI 分类失败:`, e);
				}
			}));
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

	/**
	 * 内部 AI 实现 (适配新协议)
	 */
	async _autoClassifyWithAI(
		rt: PluginRuntime,
		stockName: string,
		stockCode: string,
		exchange: string
	): Promise<StockClassification | null> {
		const db = getDB();
		const cats = watchlistLogic._getKnownCategories(db);

		if (cats.industries.length === 0 || cats.themes.length === 0) {
			return null;
		}

		const prompt = watchlistLogic._buildAiPrompt(cats.industries, cats.themes, `${stockName} (${stockCode})`, false);
		const aiText = await watchlistLogic._callEmbeddedAi(rt, `classify-${stockCode}`, prompt, 60000);

		try {
			const jsonMatch = aiText.match(/\[.*\]/s);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				const raw = parsed[0]; // 单只股票也是数组格式

				if (raw && Array.isArray(raw.category)) {
					const industryItem = raw.category.find((c: any) => cats.industries.includes(watchlistLogic._anchorToCategory(c.name, cats.industries)));
					const themesItems = raw.category.filter((c: any) => c !== industryItem);

					if (industryItem) {
						const data: StockClassification = {
							industry: {
								name: watchlistLogic._anchorToCategory(industryItem.name, cats.industries),
								weight: industryItem.weight || 100
							},
							theme: themesItems.map((t: any) => ({
								name: watchlistLogic._anchorToCategory(t.name, cats.themes),
								weight: t.weight || 0
							})),
							weight: 50
						};
						return data;
					}
				}
			}
		} catch (e) {
			console.error("[Watchlist] AI 分类解析异常:", e);
		}
		return null;
	},

	async _callEmbeddedAi(rt: PluginRuntime, sessionId: string, prompt: string, timeoutMs: number): Promise<string> {
		const fullCfg = rt.config.loadConfig();
		const workspaceDir = rt.agent.resolveAgentWorkspaceDir(fullCfg, "hedgehog-workspace");
		const sessionFile = path.join(workspaceDir, "data", "sessions", `${sessionId}.json`);
		let provider: string | undefined;
		let model: string | undefined;
		const resolveModelRef = (agentId: string): string | null => {
			const agent = fullCfg.agents?.list?.find(a => a.id === agentId);
			const modelCfg = agent?.model || fullCfg.agents?.defaults?.model;
			if (!modelCfg) return null;
			if (typeof modelCfg === 'string') return modelCfg;
			return (modelCfg as { primary?: string }).primary || null;
		};
		const modelRef = resolveModelRef("hedgehog-workspace") || resolveModelRef(fullCfg.agents?.list?.[0]?.id || "");
		if (modelRef) {
			const parts = modelRef.split('/');
			if (parts.length >= 2) {
				provider = parts[0];
				model = parts.slice(1).join('/');
			}
		}
		const result = await rt.agent.runEmbeddedAgent({
			sessionId, runId: randomUUID(), timeoutMs: 30000,
			provider: provider || String(rt.agent.defaults.provider),
			model: model || String(rt.agent.defaults.model),
			workspaceDir, sessionFile, prompt,
			bootstrapContextMode: "lightweight",
			extraSystemPrompt: "你是一个金融专家，只输出纯 JSON。请基于公司主营业务进行客观分类，确保相同逻辑下结果唯一。绝对禁止输出任何推理过程。"
		});
		return result.meta.finalAssistantVisibleText || "";
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
		const aiText = await watchlistLogic._callEmbeddedAi(rt, `smart-sort-${sessionId}`, prompt, 60000);
		const jsonMatch = aiText.match(/\[.*\]/s);
		if (jsonMatch) {
			try { return JSON.parse(jsonMatch[0]); } catch (e) { return []; }
		}
		return [];
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
		const candidates = categories.filter(c => c.includes(trimmed) || trimmed.includes(c));
		if (candidates.length === 1) return candidates[0];
		return "其他";
	}
};
