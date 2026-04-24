import { randomUUID } from "node:crypto";
import path from "node:path";
import { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
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
		`).get([stockCode, exchange]) as GlobalStockMetadataRow | undefined;

		if (cached && cached.industryJson) {
			try {
				return {
					industry: JSON.parse(cached.industryJson),
					theme: JSON.parse(cached.themeJson || '[]'),
					summary: "cached",
					weight: 50
				};
			} catch (e) {
				// 容错：如果解析失败，继续 AI 流程
			}
		}

		// 2. 缓存未命中，调用 AI 进行推断
		// 注意：这里的行业/主题列表建议从 CATEGORIES 动态获取
		const classification = await this._autoClassifyWithAI(rt, stockName, stockCode);

		if (classification) {
			// 3. 结果存入全局缓存，方便以后复用
			db.prepare(`
				INSERT OR REPLACE INTO global_stock_metadata (stockCode, exchange, stockName, industryJson, themeJson)
				VALUES (?, ?, ?, ?, ?)
			`).run([
				stockCode,
				exchange,
				stockName,
				JSON.stringify(classification.industry),
				JSON.stringify(classification.theme)
			]);
			return classification;
		}

		return null;
	},

	/**
	 * 批量获取股票分类（极速批处理）
	 */
	async getBatchStockClassification(
		rt: PluginRuntime,
		stocks: any[],
		_userId: string
	): Promise<(StockClassification | null)[]> {
		const db = getDB();
		const results = new Array(stocks.length).fill(null);
		const pendingStocks: { idx: number, name: string, code: string, exchange: string }[] = [];

		// 1. 尝试从缓存批量查询
		stocks.forEach((s, i) => {
			const cached = db.prepare(`SELECT industryJson, themeJson FROM global_stock_metadata WHERE stockCode = ? AND exchange = ?`).get([s.stockCode, s.exchange]) as GlobalStockMetadataRow | undefined;
			if (cached && cached.industryJson) {
				try {
					results[i] = {
						industry: JSON.parse(cached.industryJson),
						theme: JSON.parse(cached.themeJson || '[]'),
						summary: "cached",
						weight: 50
					};
				} catch (e) {
					pendingStocks.push({ idx: i, name: s.stockName, code: s.stockCode, exchange: s.exchange });
				}
			} else {
				pendingStocks.push({ idx: i, name: s.stockName, code: s.stockCode, exchange: s.exchange });
			}
		});

		// 2. 如果有缓存缺失，一并交给 AI 处理
		if (pendingStocks.length > 0) {
			const stocksList = pendingStocks.map(s => `- ${s.name} (${s.code})`).join("\n");
			const cats = this._getKnownCategories(db);
			if (cats.industries.length === 0) return results;

			const prompt = this._buildAiPrompt(cats.industries, cats.themes, stocksList, true);

			const aiText = await this._callEmbeddedAi(rt, `classify-batch`, prompt, 120000);
			try {
				const jsonMatch = aiText.match(/\[.*\]/s);
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0]);
					pendingStocks.forEach((ps, i) => {
						const raw = parsed[i];
						if (raw) {
							// 校验
							const classification = StockClassificationSchema.safeParse(raw);
							if (classification.success) {
								const data = classification.data;
								results[ps.idx] = data;
								// 写入全局缓存
								db.prepare(`INSERT OR REPLACE INTO global_stock_metadata (stockCode, exchange, stockName, industryJson, themeJson) VALUES (?, ?, ?, ?, ?)`)
									.run(ps.code, ps.exchange, ps.name, JSON.stringify(data.industry), JSON.stringify(data.theme));
							}
						}
					});
				}
			} catch (e) {
				console.error("[Watchlist] 批量 AI 分类失败:", e);
			}
		}

		return results;
	},

	/**
	 * 获取全量行业/主题列表 (这里建议后续从后端同步)
	 */
	_getKnownCategories(db: any) {
		const industries = db.prepare("SELECT name FROM watchlist_categories WHERE type = 'industry'").all() as any[];
		const themes = db.prepare("SELECT name FROM watchlist_categories WHERE type = 'theme'").all() as any[];
		return {
			industries: industries.map(i => i.name),
			themes: themes.map(t => t.name)
		};
	},

	/**
	 * 内部 AI 实现 (保持同步调用)
	 */
	async _autoClassifyWithAI(
		rt: PluginRuntime,
		stockName: string,
		stockCode: string
	): Promise<StockClassification | null> {
		const db = getDB();
		const cats = this._getKnownCategories(db);

		if (cats.industries.length === 0 || cats.themes.length === 0) {
			console.warn("[Watchlist] 警告：行业或主题分类字典为空，请先同步字典！");
			return null;
		}


		const prompt = this._buildAiPrompt(cats.industries, cats.themes, `${stockName} (${stockCode})`, false);

		const aiText = await this._callEmbeddedAi(rt, `classify-${stockCode}`, prompt, 60000);
		try {
			const jsonMatch = aiText.match(/\{.*\}/s);
			if (jsonMatch) {
				const raw = JSON.parse(jsonMatch[0]);
				const validated = StockClassificationSchema.safeParse(raw);
				if (validated.success) return validated.data;
				console.error("[Watchlist] AI 返回数据格式验证失败:", validated.error);
			}
		} catch (e) {
			console.error("[Watchlist] AI 分类解析异常:", e);
		}
		return null;
	},

	/**
	 * [提炼] 统一 AI 调度器
	 */
	async _callEmbeddedAi(rt: PluginRuntime, sessionId: string, prompt: string, timeoutMs: number): Promise<string> {
		const cfg = rt.config.loadConfig();
		const workspaceDir = rt.agent.resolveAgentWorkspaceDir(cfg, "ciwei-ai");
		const sessionFile = path.join(workspaceDir, "data", "sessions", `${sessionId}.json`);

		const result = await rt.agent.runEmbeddedAgent({
			sessionId,
			runId: randomUUID(),
			timeoutMs,
			workspaceDir,
			sessionFile,
			prompt,
			extraSystemPrompt: "金融专家模式，只输出纯 JSON，绝对禁止输出任何推理过程或 Markdown 围栏。"
		});
		console.log(result.meta.finalAssistantVisibleText);
		return result.meta.finalAssistantVisibleText || "";
	},

	/**
	 * [提炼] 统一分类指令构建器
	 */
	_buildAiPrompt(industries: string[], themes: string[], input: string, isBatch: boolean): string {
		return `
[Role] 证券分类专家
[Task] ${isBatch ? "批量" : "个股"}分类映射与权重评分
[Constraints]
1. 行业强制锁定为：${industries.join(", ")}
2. 主题强制锁定为：${themes.join(", ")}
3. 严禁解释或输出 Markdown，仅返回 ${isBatch ? "JSON 数组" : "纯 JSON 对象"}。
4. ${isBatch ? "顺序必须与输入列表完全一致。" : "若无法完全匹配，返回最接近的项或'其他'。"}

${isBatch ? "[Input List]" : "[Input]"}
${input}

[Output Format]
${isBatch ? '[{"industry": {"name": "...", "weight": 90}, "theme": [{"name": "...", "weight": 80}]}, ...]' : '{"industry": {"name": "...", "weight": 90}, "theme": [{"name": "...", "weight": 80}]}'}
Output:`;
	}
};
