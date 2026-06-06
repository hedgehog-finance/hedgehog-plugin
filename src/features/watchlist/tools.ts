import { randomUUID } from "node:crypto";
// @ts-ignore
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { PluginRuntime } from "openclaw/plugin-sdk";
import { getDB } from "../../core/database.js";
import { logger } from "../../core/logger.js";
import { watchlistLogic } from "./logic.js";
import {
	AddToWatchlistParams,
	AddToWatchlistParamsSchema,
	UpdateWatchlistItemParams,
	UpdateWatchlistItemSchema,
	WatchlistRow,
	CategoryRow,
	GetWatchlistParams,
	GetWatchlistParamsSchema,
	SyncCategoriesParams,
	SyncCategoriesParamsSchema,
	BatchUpdateSortOrdersParams,
	BatchUpdateSortOrdersParamsSchema,
	GetIndustryListParamsSchema,
	GetIndustryListParams
} from "./schema.js";

let watchlistMutationQueue: Promise<void> = Promise.resolve();

const GetWatchlistAgentToolSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		categoryId: { type: "string", description: "分类 ID，不传返回所有" },
		categoryType: { type: "string", enum: ["industry", "theme"], description: "分类类型" }
	}
};

const GetIndustryListAgentToolSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		type: { type: "string", enum: ["industry", "theme", ""], description: "分类类型：industry 行业，theme 主题，空字符串或不传表示全部" }
	}
};

function enqueueWatchlistMutation<T>(task: () => Promise<T>): Promise<T> {
	const previous = watchlistMutationQueue;
	let release!: () => void;
	watchlistMutationQueue = new Promise<void>((resolve) => {
		release = resolve;
	});

	return previous
		.catch(() => undefined)
		.then(task)
		.finally(release);
}

function normalizeTags(input: { name: string; weight?: number } | { name: string; weight?: number }[] | null | undefined): { name: string, weight: number }[] {
	if (!input) return [];
	const items = Array.isArray(input) ? input : [input];
	return items
		.filter((item): item is { name: string; weight?: number } => typeof item?.name === 'string' && item.name.trim().length > 0)
		.map(item => ({ name: item.name, weight: item.weight ?? 0 }));
}

function normalizeWatchlistStock(stock: AddToWatchlistParams): AddToWatchlistParams {
	return {
		...stock,
		stock_code: watchlistLogic._normalizeStockCodeForCache(stock.stock_code, stock.exchange)
	};
}

function watchlistStockKey(stock: AddToWatchlistParams): string {
	return `${watchlistLogic._normalizeStockCodeForCache(stock.stock_code, stock.exchange)}:${stock.exchange}`;
}

function updateWatchlistTags(
	db: DatabaseSync,
	watchlistId: string,
	userId: string,
	industry: { name: string; weight?: number } | null | undefined,
	theme: { name: string; weight?: number }[] | undefined
) {
	db.prepare("DELETE FROM watchlist_industry_items WHERE watchlistId = ? AND userId = ?").run(watchlistId, userId);
	db.prepare("DELETE FROM watchlist_theme_items WHERE watchlistId = ? AND userId = ?").run(watchlistId, userId);

	const normIndustries = normalizeTags(industry);
	for (const item of normIndustries) {
		const categoryId = watchlistLogic._ensureCategory(db, item.name, 'industry', userId);
		if (categoryId) {
			db.prepare(`
				INSERT OR IGNORE INTO watchlist_industry_items (id, watchlistId, userId, categoryId, weight)
				VALUES (?, ?, ?, ?, ?)
			`).run(randomUUID(), watchlistId, userId, categoryId, item.weight);
		}
	}

	const normThemes = normalizeTags(theme);
	for (const item of normThemes) {
		const categoryId = watchlistLogic._ensureCategory(db, item.name, 'theme', userId);
		if (categoryId) {
			db.prepare(`
				INSERT OR IGNORE INTO watchlist_theme_items (id, watchlistId, userId, categoryId, weight)
				VALUES (?, ?, ?, ?, ?)
			`).run(randomUUID(), watchlistId, userId, categoryId, item.weight);
		}
	}
}

function upsertStockClassificationCache(
	db: DatabaseSync,
	stock: AddToWatchlistParams,
	classification: {
		industry: { name: string; weight?: number };
		theme?: { name: string; weight?: number }[];
	}
) {
	const cacheCode = watchlistLogic._normalizeStockCodeForCache(stock.stock_code, stock.exchange);
	const legacyCode = stock.stock_code.trim().toUpperCase().replace(/\.(SH|SS|SZ|HK|US)$/i, "");
	db.prepare(`
		INSERT OR REPLACE INTO stock_classification_cache (stock_code, exchange, stock_name, industry_classification, theme_classification)
		VALUES (?, ?, ?, ?, ?)
	`).run(
		cacheCode,
		stock.exchange,
		stock.stock_name,
		JSON.stringify(classification.industry),
		JSON.stringify(classification.theme || [])
	);
	if (legacyCode && legacyCode !== cacheCode) {
		db.prepare(`
			DELETE FROM stock_classification_cache WHERE stock_code = ? AND exchange = ?
		`).run(legacyCode, stock.exchange);
	}
}

function readWatchlistRows(db: DatabaseSync, args: GetWatchlistParams, userId?: string): WatchlistRow[] {
	let query: string;
	const params: any[] = [];

	if (userId) {
		params.push(userId);
		if (args.categoryId && args.categoryType) {
			const table = args.categoryType === "industry" ? "watchlist_industry_items" : "watchlist_theme_items";
			query = `
				SELECT w.*, ci.weight as relWeight
				FROM watchlist w
				JOIN ${table} ci ON w.id = ci.watchlistId
				WHERE w.userId = ? AND w.isDeleted = 0 AND ci.categoryId = ?
				ORDER BY w.sortOrder ASC
			`;
			params.push(args.categoryId);
		} else {
			query = `
				SELECT w.*
				FROM watchlist w
				WHERE w.userId = ? AND w.isDeleted = 0
				ORDER BY w.sortOrder ASC
			`;
		}
	} else if (args.categoryId && args.categoryType) {
		const table = args.categoryType === "industry" ? "watchlist_industry_items" : "watchlist_theme_items";
		query = `
			SELECT w.*, ci.weight as relWeight
			FROM watchlist w
			JOIN ${table} ci ON w.id = ci.watchlistId
			WHERE w.isDeleted = 0 AND ci.categoryId = ?
			ORDER BY w.userId ASC, w.sortOrder ASC
		`;
		params.push(args.categoryId);
	} else {
		query = `
			SELECT w.*
			FROM watchlist w
			WHERE w.isDeleted = 0
			ORDER BY w.userId ASC, w.sortOrder ASC
		`;
	}

	return db.prepare(query).all(...params) as WatchlistRow[];
}

function attachWatchlistTags(db: DatabaseSync, stocks: WatchlistRow[]) {
	return stocks.map(stock => {
		const industries = db.prepare(`
			SELECT c.name FROM industry_theme_categories c
			JOIN watchlist_industry_items i ON c.id = i.categoryId
			WHERE i.watchlistId = ? ORDER BY i.weight DESC
		`).all(stock.id) as { name: string }[];
		const themes = db.prepare(`
			SELECT c.name FROM industry_theme_categories c
			JOIN watchlist_theme_items t ON c.id = t.categoryId
			WHERE t.watchlistId = ? ORDER BY t.weight DESC
		`).all(stock.id) as { name: string }[];
		return {
			...stock,
			industries: industries.map(i => i.name),
			themes: themes.map(t => t.name)
		};
	});
}

export const watchlistTools = {
	add_to_watchlist: {
		name: "add_to_watchlist",
		description: "添加股票到自选列表",
		parameters: AddToWatchlistParamsSchema,
		registerTool: false,
		execute: async (args: AddToWatchlistParams, ctx: { userId: string, runtime?: PluginRuntime }) => {
			return enqueueWatchlistMutation(async () => {
				const uId = String(ctx.userId);
				if (!ctx.runtime) {
					return JSON.stringify({ success: false, error: "无法分析行业/主题关系：runtime 不可用" });
				}
				const db = getDB();
				const stock = normalizeWatchlistStock(args);
				const existingBeforeClassify = db.prepare("SELECT id, isDeleted FROM watchlist WHERE userId = ? AND stock_code = ? AND exchange = ?")
					.get(uId, stock.stock_code, stock.exchange) as WatchlistRow | undefined;
				if (existingBeforeClassify?.isDeleted === 0) {
					return JSON.stringify({ success: true, skipped: true, reason: "duplicate", id: existingBeforeClassify.id });
				}

				const currentCount = (db.prepare("SELECT COUNT(*) as count FROM watchlist WHERE userId = ? AND isDeleted = 0").get(uId) as { count: number }).count;
				if (currentCount >= 30) {
					return JSON.stringify({ success: false, error: "自选股数量已达 30 只上限，请先移除部分股票" });
				}

				let classification: Awaited<ReturnType<typeof watchlistLogic.getStockClassification>>;
				try {
					classification = await watchlistLogic.getStockClassification(ctx.runtime, stock.stock_name, stock.stock_code, stock.exchange, uId);
				} catch (e: any) {
					return JSON.stringify({ success: false, error: e.message });
				}
				if (!classification) {
					return JSON.stringify({ success: false, error: "行业/主题关系分析失败" });
				}

				if (db.inTransaction) db.exec("ROLLBACK");
				db.exec("BEGIN TRANSACTION");
				try {
					const sortRow = db.prepare("SELECT MAX(sortOrder) as max FROM watchlist WHERE userId=? AND isDeleted=0").get(uId) as { max: number } | undefined;
					const nextOrder = (sortRow?.max ?? 0) + 1024;

					let watchlistId: string;
					const existingItem = db.prepare("SELECT id, isDeleted FROM watchlist WHERE userId = ? AND stock_code = ? AND exchange = ?").get(uId, stock.stock_code, stock.exchange) as WatchlistRow | undefined;

					if (existingItem) {
						watchlistId = existingItem.id;
						if (existingItem.isDeleted === 1) {
							db.prepare(`
								UPDATE watchlist SET isDeleted = 0, stock_name = ?, sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') WHERE id = ?
							`).run(stock.stock_name, nextOrder, watchlistId);
						} else {
							db.exec("ROLLBACK");
							return JSON.stringify({ success: true, skipped: true, reason: "duplicate", id: watchlistId });
						}
					} else {
						watchlistId = randomUUID();
						db.prepare(`
							INSERT INTO watchlist (id, userId, stock_code, stock_name, exchange, market, sortOrder)
							VALUES (?, ?, ?, ?, ?, ?, ?)
						`).run(watchlistId, uId, stock.stock_code, stock.stock_name, stock.exchange, stock.market, nextOrder);
					}

					upsertStockClassificationCache(db, stock, classification);
					updateWatchlistTags(db, watchlistId, uId, classification.industry, classification.theme);
					db.exec("COMMIT");
					return JSON.stringify({ success: true, id: watchlistId });
				} catch (e: any) {
					if (db.inTransaction) db.exec("ROLLBACK");
					return JSON.stringify({ success: false, error: e.message });
				}
			});
		}
	},

	batch_add_to_watchlist: {
		name: "batch_add_to_watchlist",
		description: "批量添加股票到自选列表。添加多只股票时必须使用这个工具，不要循环调用 add_to_watchlist。",
		parameters: z.object({ stocks: z.array(AddToWatchlistParamsSchema) }),
		registerTool: false,
		execute: async (args: { stocks: AddToWatchlistParams[] }, ctx: { userId: string, runtime?: PluginRuntime }) => {
			return enqueueWatchlistMutation(async () => {
				if (!Array.isArray(args.stocks) || args.stocks.length === 0) {
					return JSON.stringify({ success: false, error: "批量添加失败：stocks 不能为空" });
				}
				if (!ctx.runtime) {
					return JSON.stringify({ success: false, error: "无法分析行业/主题关系：runtime 不可用" });
				}

				const db = getDB();
				const uId = String(ctx.userId);
				const uniqueStocks: AddToWatchlistParams[] = [];
				const inputSeen = new Set<string>();
				const skipped: { stock_code: string; exchange: string; reason: "input_duplicate" | "duplicate"; id?: string }[] = [];
				for (const rawStock of args.stocks) {
					const stock = normalizeWatchlistStock(rawStock);
					const key = watchlistStockKey(stock);
					if (inputSeen.has(key)) {
						skipped.push({ stock_code: stock.stock_code, exchange: stock.exchange, reason: "input_duplicate" });
						continue;
					}
					inputSeen.add(key);
					uniqueStocks.push(stock);
				}
				const stocksToAdd: AddToWatchlistParams[] = [];
				for (const stock of uniqueStocks) {
					const existing = db.prepare("SELECT id, isDeleted FROM watchlist WHERE userId = ? AND stock_code = ? AND exchange = ?")
						.get(uId, stock.stock_code, stock.exchange) as WatchlistRow | undefined;
					if (existing?.isDeleted === 0) {
						skipped.push({ stock_code: stock.stock_code, exchange: stock.exchange, reason: "duplicate", id: existing.id });
					} else {
						stocksToAdd.push(stock);
					}
				}
				if (stocksToAdd.length === 0) {
					return JSON.stringify({ success: true, ids: [], skipped });
				}

				const currentCount = (db.prepare("SELECT COUNT(*) as count FROM watchlist WHERE userId = ? AND isDeleted = 0").get(uId) as { count: number }).count;
				if (currentCount + stocksToAdd.length > 30) {
					return JSON.stringify({
						success: false,
						error: `自选股数量已达 30 只上限（当前已有 ${currentCount} 只，本次尝试添加 ${stocksToAdd.length} 只）`
					});
				}

				let batchResults: Awaited<ReturnType<typeof watchlistLogic.classifyStocksTogether>>;
				try {
					batchResults = await watchlistLogic.classifyStocksTogether(ctx.runtime, stocksToAdd, uId);
				} catch (e: any) {
					logger.warn({
						count: stocksToAdd.length,
						codes: stocksToAdd.map(stock => stock.stock_code),
						error: e.message || String(e)
					}, "[Watchlist] batch_add_to_watchlist classification failed");
					return JSON.stringify({
						success: false,
						failedStage: "classification",
						error: e.message || "批量添加失败：行业/主题关系分析失败"
					});
				}

				if (db.inTransaction) db.exec("ROLLBACK");
				db.exec("BEGIN TRANSACTION");
				try {
					const results: string[] = [];
					const writtenItems: { id: string; stock: AddToWatchlistParams; classification: typeof batchResults[number] }[] = [];
					const sortRow = db.prepare("SELECT MAX(sortOrder) as max FROM watchlist WHERE userId=? AND isDeleted=0").get(uId) as { max: number } | undefined;
					let currentMaxOrder = sortRow?.max ?? 0;

					stocksToAdd.forEach((stock, i) => {
						const nextOrder = currentMaxOrder + 1024;
						currentMaxOrder = nextOrder;
						const classification = batchResults[i];
						if (!classification) {
							throw new Error(`行业/主题关系分析失败: ${stock.stock_name}`);
						}

						let watchlistId: string;
						const existingItem = db.prepare("SELECT id, isDeleted FROM watchlist WHERE userId = ? AND stock_code = ? AND exchange = ?").get(uId, stock.stock_code, stock.exchange) as WatchlistRow | undefined;

						if (existingItem) {
							watchlistId = existingItem.id;
							if (existingItem.isDeleted === 1) {
								db.prepare(`
									UPDATE watchlist SET isDeleted = 0, stock_name = ?, sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') WHERE id = ?
								`).run(stock.stock_name, nextOrder, watchlistId);
							} else {
								skipped.push({ stock_code: stock.stock_code, exchange: stock.exchange, reason: "duplicate", id: watchlistId });
								return;
							}
						} else {
							watchlistId = randomUUID();
							db.prepare(`
								INSERT INTO watchlist (id, userId, stock_code, stock_name, exchange, market, sortOrder)
								VALUES (?, ?, ?, ?, ?, ?, ?)
							`).run(watchlistId, uId, stock.stock_code, stock.stock_name, stock.exchange, stock.market, nextOrder);
						}
						results.push(watchlistId);
						writtenItems.push({ id: watchlistId, stock, classification });
					});

					if (writtenItems.length > 0) {
						writtenItems.forEach(({ id, stock, classification }) => {
							upsertStockClassificationCache(db, stock, classification);
							updateWatchlistTags(db, id, uId, classification.industry, classification.theme);
						});
					}

					db.exec("COMMIT");
					return JSON.stringify({ success: true, ids: results, skipped });
				} catch (e: any) {
					if (db.inTransaction) db.exec("ROLLBACK");
					return JSON.stringify({ success: false, error: e.message });
				}
			});
		}
	},

	remove_from_watchlist: {
		name: "remove_from_watchlist",
		description: "将股票从自选列表中移除",
		parameters: z.object({ id: z.string() }),
		registerTool: false,
		execute: async (args: { id: string }, ctx: { userId: string }) => {
			return enqueueWatchlistMutation(async () => {
				const db = getDB();
				const uId = String(ctx.userId);

				if (db.inTransaction) db.exec("ROLLBACK");
				db.exec("BEGIN TRANSACTION");
				try {
					const info = db.prepare(`
						DELETE FROM watchlist
						WHERE id = ?
						  AND userId = ?
					`).run(args.id, uId);

					if (info.changes > 0) {
						db.prepare("DELETE FROM watchlist_industry_items WHERE watchlistId = ? AND userId = ?").run(args.id, uId);
						db.prepare("DELETE FROM watchlist_theme_items WHERE watchlistId = ? AND userId = ?").run(args.id, uId);

						// 同时删除该自选股关联的所有投研笔记及笔记内保存的资料库关联记录
						db.prepare(`
							DELETE FROM stock_note_profile_libraries 
							WHERE userId = ? 
							  AND noteId IN (SELECT id FROM stock_notes WHERE watchlistId = ? AND userId = ?)
						`).run(uId, args.id, uId);
						db.prepare("DELETE FROM stock_notes WHERE watchlistId = ? AND userId = ?").run(args.id, uId);
					}

					db.exec("COMMIT");
					return JSON.stringify({ success: info.changes > 0 });
				} catch (e: any) {
					if (db.inTransaction) db.exec("ROLLBACK");
					return JSON.stringify({ success: false, error: e.message });
				}
			});
		}
	},

	get_watchlist: {
		name: "get_watchlist",
		label: "获取自选股",
		description: "获取当前全部自选股列表及其行业、主题标签。",
		parameters: GetWatchlistAgentToolSchema,
		registerTool: true,
		execute: async (rawArgs?: GetWatchlistParams, ctx?: { userId: string }) => {
			try {
				const args = GetWatchlistParamsSchema.parse(rawArgs ?? {});
				const db = getDB();
				const stocks = readWatchlistRows(db, args, ctx?.userId ? String(ctx.userId) : undefined);
				const fullList = attachWatchlistTags(db, stocks);
				return JSON.stringify({ success: true, data: fullList });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	get_industry_list: {
		name: "get_industry_list",
		label: "拉取申万一级行业分类或主题板块列表",
		description: "拉取申万一级行业分类或主题板块列表。",
		parameters: GetIndustryListAgentToolSchema,
		registerTool: true,
		execute: async (rawArgs?: GetIndustryListParams) => {
			try {
				const args = GetIndustryListParamsSchema.parse(rawArgs ?? {});
				const db = getDB();
				let query = "SELECT DISTINCT name FROM industry_theme_categories";
				const params: any[] = [];
				const conditions: string[] = [];

				if (args.type && args.type !== "") {
					conditions.push("type = ?");
					params.push(args.type);
				}

				if (conditions.length > 0) {
					query += ` WHERE ${conditions.join(" AND ")}`;
				}
				query += " ORDER BY name ASC";
				const rows = db.prepare(query).all(...params) as { name: string }[];
				const data = rows.map(r => r.name);
				return JSON.stringify({ success: true, data });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	get_thematic_dashboard: {
		name: "get_thematic_dashboard",
		description: "获取聚合后的主题/行业看板数据",
		parameters: z.object({}),
		registerTool: false,
		execute: async (_args: {}, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const industryData = db.prepare(`
					SELECT c.name as category_name, i.weight, w.stock_code
					FROM industry_theme_categories c
					JOIN watchlist_industry_items i ON c.id = i.categoryId
					JOIN watchlist w ON i.watchlistId = w.id
					WHERE i.userId = ? AND w.isDeleted = 0
				`).all(uId) as any[];
				const themeData = db.prepare(`
					SELECT c.name as category_name, t.weight, w.stock_code
					FROM industry_theme_categories c
					JOIN watchlist_theme_items t ON c.id = t.categoryId
					JOIN watchlist w ON t.watchlistId = w.id
					WHERE t.userId = ? AND w.isDeleted = 0
				`).all(uId) as any[];
				const combined = [...industryData, ...themeData];
				const aggMap = new Map<string, { category_name: string, weight_total: number, stocks: string[] }>();
				combined.forEach(item => {
					const name = item.category_name;
					const existing: { category_name: string, weight_total: number, stocks: string[] } = aggMap.get(name) || { category_name: name, weight_total: 0, stocks: [] };
					existing.weight_total += (item.weight || 0);
					if (!existing.stocks.includes(item.stock_code)) {
						existing.stocks.push(item.stock_code);
					}
					aggMap.set(name, existing);
				});
				const result = Array.from(aggMap.values()).sort((a, b) => b.weight_total - a.weight_total);
				return JSON.stringify({ success: true, data: result });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	get_watchlist_tabs: {
		name: "get_watchlist_tabs",
		description: "获取分类页签",
		parameters: z.object({}),
		registerTool: false,
		execute: async (_args: {}, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const industries = db.prepare(`
					SELECT DISTINCT c.id, c.name, c.type, c.sortOrder
					FROM industry_theme_categories c
					JOIN watchlist_industry_items i ON c.id = i.categoryId
					WHERE i.userId = ?
					ORDER BY c.sortOrder ASC, c.name ASC
				`).all(uId) as any[];
				const themes = db.prepare(`
					SELECT DISTINCT c.id, c.name, c.type, c.sortOrder
					FROM industry_theme_categories c
					JOIN watchlist_theme_items t ON c.id = t.categoryId
					WHERE t.userId = ?
					ORDER BY c.sortOrder ASC, c.name ASC
				`).all(uId) as any[];
				const tabs = [
					{ id: "all", name: "全部", type: "all" },
					...industries.map(i => ({ id: i.id, name: i.name, type: "industry" })),
					...themes.map(t => ({ id: t.id, name: t.name, type: "theme" }))
				];
				return JSON.stringify({ success: true, data: tabs });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	smart_reorder_watchlist: {
		name: "smart_reorder_watchlist",
		description: "触发 AI 智能排序",
		parameters: z.object({}),
		registerTool: false,
		execute: async (_args: {}, ctx: { userId: string, runtime?: PluginRuntime }) => {
			if (!ctx.runtime) return JSON.stringify({ success: false, error: "Runtime not available" });
			const db = getDB();
			const uId = String(ctx.userId);
			try {
				const stocks = db.prepare("SELECT stock_code as code, stock_name as name FROM watchlist WHERE userId = ? AND isDeleted = 0").all(uId) as any[];
				if (stocks.length === 0) return JSON.stringify({ success: true, message: "没有可排序的股票" });
				const sortedResults = await watchlistLogic.applySmartSort(ctx.runtime, `sort-${uId}`, stocks);
				if (sortedResults.length > 0) {
					db.exec("BEGIN TRANSACTION");
					const stmt = db.prepare(`
						UPDATE watchlist SET sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
						WHERE userId = ? AND stock_code = ? AND isDeleted = 0
					`);
					sortedResults.forEach((item: any, i: number) => {
						const currentOrder = i * 10;
						stmt.run(currentOrder, uId, item.code);
					});
					db.exec("COMMIT");
					return JSON.stringify({ success: true, message: "智能排序已完成" });
				}
				return JSON.stringify({ success: false, error: "AI 未能返回有效的排序结果" });
			} catch (e: any) {
				if (db.inTransaction) db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	sync_watchlist_categories: {
		name: "sync_watchlist_categories",
		description: "同步分类字典",
		parameters: SyncCategoriesParamsSchema,
		registerTool: false,
		execute: async (args: SyncCategoriesParams, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				const existing = db.prepare("SELECT name, type FROM industry_theme_categories WHERE userId = ?").all(uId) as { name: string, type: string }[];
				const existingSet = new Set(existing.map(row => `${row.name}:${row.type}`));

				const stmt = db.prepare(`
					INSERT INTO industry_theme_categories (id, remoteId, userId, name, type, weight, sortOrder)
					VALUES (?, ?, ?, ?, ?, 0, 0)
					ON CONFLICT(userId, remoteId) DO UPDATE SET name = excluded.name, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
					ON CONFLICT(userId, name, type) DO UPDATE SET remoteId = excluded.remoteId, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
				`);

				if (args.industries) {
					for (const name of args.industries) {
						const key = `${name}:industry`;
						if (!existingSet.has(key)) {
							stmt.run(randomUUID(), name, uId, name, 'industry');
							existingSet.add(key);
						}
					}
				}
				if (args.themes) {
					for (const name of args.themes) {
						const key = `${name}:theme`;
						if (!existingSet.has(key)) {
							stmt.run(randomUUID(), name, uId, name, 'theme');
							existingSet.add(key);
						}
					}
				}
				db.exec("COMMIT");
				return JSON.stringify({ success: true });
			} catch (e: any) {
				if (db.inTransaction) db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	batch_update_sort_orders: {
		name: "batch_update_sort_orders",
		description: "批量更新排序",
		parameters: BatchUpdateSortOrdersParamsSchema,
		registerTool: false,
		execute: async (args: BatchUpdateSortOrdersParams, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				const stmt = db.prepare(`UPDATE watchlist SET sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') WHERE id = ? AND userId = ? AND isDeleted = 0`);
				args.orderedIds.forEach((id, i) => {
					const weight = i * 1024;
					stmt.run(weight, id, uId);
				});
				db.exec("COMMIT");
				return JSON.stringify({ success: true });
			} catch (e: any) {
				db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	reset_watchlist_classification: {
		name: "reset_watchlist_classification",
		description: "清除并重新进行智能分类",
		parameters: z.object({}),
		registerTool: false,
		execute: async (_args: {}, ctx: { userId: string, runtime?: PluginRuntime }) => {
			if (!ctx.runtime) return JSON.stringify({ success: false, error: "Runtime not available" });
			const db = getDB();
			const uId = String(ctx.userId);
			try {
				const stocks = db.prepare("SELECT stock_name, stock_code, exchange, market FROM watchlist WHERE userId = ? AND isDeleted = 0").all(uId) as any[];
				if (stocks.length > 30) {
					return JSON.stringify({ success: false, error: "自选股数量超过 30 只，暂不支持批量重置分类" });
				}
				if (stocks.length > 0) {
					// 1. 强制等待 AI 批量分类结果（在事务外部执行耗时 API 请求，避免锁库）
					const batchResults = await watchlistLogic.getBatchStockClassification(ctx.runtime, stocks, uId, {
						forceRefresh: true,
						requireComplete: true
					});

					// 2. 开启数据库事务，清空并更新分类
					db.exec("BEGIN TRANSACTION");
					try {
						db.prepare("DELETE FROM watchlist_industry_items WHERE userId = ?").run(uId);
						db.prepare("DELETE FROM watchlist_theme_items WHERE userId = ?").run(uId);

						const userStocks = db.prepare("SELECT id, stock_code, exchange FROM watchlist WHERE userId = ? AND isDeleted = 0").all(uId) as any[];
						batchResults.forEach((res, i) => {
							if (res) {
								const s = stocks[i];
								const match = userStocks.find(us => us.stock_code === s.stock_code && us.exchange === s.exchange);
								if (match) {
									upsertStockClassificationCache(db, {
										stock_name: s.stock_name,
										stock_code: s.stock_code,
										exchange: s.exchange,
										market: s.market
									}, res);
									const cats = [
										...(res.industry ? [{ name: res.industry.name, type: 'industry' as const, weight: res.industry.weight }] : []),
										...res.theme.map((t: any) => ({ name: t.name, type: 'theme' as const, weight: t.weight }))
									];
									cats.forEach(c => {
										const catId = watchlistLogic._ensureCategory(db, c.name, c.type, uId);
										if (catId) {
											const table = c.type === 'industry' ? 'watchlist_industry_items' : 'watchlist_theme_items';
											db.prepare(`INSERT OR IGNORE INTO ${table} (id, watchlistId, userId, categoryId, weight) VALUES (?, ?, ?, ?, ?)`).run(randomUUID(), match.id, uId, catId, c.weight);
										}
									});
								}
							}
						});
						db.exec("COMMIT");
					} catch (transactionError: any) {
						if (db.inTransaction) db.exec("ROLLBACK");
						throw transactionError;
					}
				} else {
					// 如果没有自选股，也正常开启事务清空旧的分类数据
					db.exec("BEGIN TRANSACTION");
					try {
						db.prepare("DELETE FROM watchlist_industry_items WHERE userId = ?").run(uId);
						db.prepare("DELETE FROM watchlist_theme_items WHERE userId = ?").run(uId);
						db.exec("COMMIT");
					} catch (transactionError: any) {
						if (db.inTransaction) db.exec("ROLLBACK");
						throw transactionError;
					}
				}
				return JSON.stringify({ success: true, message: "智能分类已完成重置" });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message || "重置分类失败" });
			}
		}
	}
};
