import { randomUUID } from "node:crypto";
// @ts-ignore
import { DatabaseSync } from "node:sqlite";
import { z } from "openclaw/plugin-sdk/zod";
import { PluginRuntime } from "openclaw/plugin-sdk";
import { getDB } from "../../core/database";
import { watchlistLogic } from "./logic";
import {
	AddToWatchlistParams,
	AddToWatchlistParamsSchema,
	UpdateWatchlistItemParams,
	UpdateWatchlistItemSchema,
	WatchlistRow,
	CategoryRow,
	TagInput,
	GetWatchlistParams,
	GetWatchlistParamsSchema,
	SyncCategoriesParams,
	SyncCategoriesParamsSchema,
	BatchUpdateSortOrdersParams,
	BatchUpdateSortOrdersParamsSchema
} from "./schema";

/**
 * 辅助函数：统一处理归一化分类项
 */
function normalizeTags(input: TagInput | undefined): { name: string, weight: number }[] {
	if (!input) return [];
	const items = Array.isArray(input) ? input : [input];
	return items.map(item => {
		if (typeof item === 'string') return { name: item, weight: 0 };
		if (typeof item === 'object' && item !== null && 'name' in item) {
			return { name: item.name, weight: item.weight ?? 0 };
		}
		return null;
	}).filter((i): i is { name: string, weight: number } => i !== null);
}

/**
 * 辅助函数：更新股票的分类标签
 */
function updateWatchlistTags(db: DatabaseSync, watchlistId: string, userId: string, industry: TagInput | undefined, theme: TagInput | undefined) {
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

export const watchlistTools = {
	add_to_watchlist: {
		name: "add_to_watchlist",
		description: "添加股票到自选列表",
		parameters: AddToWatchlistParamsSchema,
		execute: async (args: AddToWatchlistParams, ctx: { userId: string, runtime?: PluginRuntime }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				const sortRow = db.prepare("SELECT MAX(sortOrder) as max FROM watchlist WHERE userId=? AND isDeleted=0").get(uId) as { max: number } | undefined;
				const nextOrder = (sortRow?.max ?? 0) + 1024;

				let watchlistId: string;
				const existingItem = db.prepare("SELECT id, isDeleted FROM watchlist WHERE userId = ? AND stockCode = ? AND exchange = ?").get(uId, args.stockCode, args.exchange) as WatchlistRow | undefined;

				if (existingItem) {
					watchlistId = existingItem.id;
					if (existingItem.isDeleted === 1) {
						db.prepare(`
							UPDATE watchlist SET isDeleted = 0, stockName = ?, sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') WHERE id = ?
						`).run(args.stockName, nextOrder, watchlistId);
					} else {
						db.prepare(`
							UPDATE watchlist SET stockName = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') WHERE id = ?
						`).run(args.stockName, watchlistId);
					}
				} else {
					watchlistId = randomUUID();
					db.prepare(`
						INSERT INTO watchlist (id, userId, stockCode, stockName, exchange, market, sortOrder)
						VALUES (?, ?, ?, ?, ?, ?, ?)
					`).run(watchlistId, uId, args.stockCode, args.stockName, args.exchange, args.market, nextOrder);
				}

				if (!args.industry && !args.theme && ctx.runtime) {
					watchlistLogic.getStockClassification(ctx.runtime, args.stockName, args.stockCode, args.exchange, uId)
						.then(classification => {
							if (classification) {
								const db2 = getDB();
								updateWatchlistTags(db2, watchlistId, uId, classification.industry, classification.theme);
							}
						}).catch(err => console.error("[Watchlist] 自动分类失败:", err));
				} else {
					updateWatchlistTags(db, watchlistId, uId, args.industry, args.theme);
				}
				db.exec("COMMIT");
				return JSON.stringify({ success: true, id: watchlistId });
			} catch (e: any) {
				db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	batch_add_to_watchlist: {
		name: "batch_add_to_watchlist",
		description: "批量添加股票到自选列表",
		parameters: z.object({ stocks: z.array(AddToWatchlistParamsSchema) }),
		execute: async (args: { stocks: AddToWatchlistParams[] }, ctx: { userId: string, runtime?: PluginRuntime }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				const results: string[] = [];
				const sortRow = db.prepare("SELECT MAX(sortOrder) as max FROM watchlist WHERE userId=? AND isDeleted=0").get(uId) as { max: number } | undefined;
				let currentMaxOrder = sortRow?.max ?? 0;

				for (const stock of args.stocks) {
					const nextOrder = currentMaxOrder + 1024;
					currentMaxOrder = nextOrder;

					let watchlistId: string;
					const existingItem = db.prepare("SELECT id, isDeleted FROM watchlist WHERE userId = ? AND stockCode = ? AND exchange = ?").get(uId, stock.stockCode, stock.exchange) as WatchlistRow | undefined;

					if (existingItem) {
						watchlistId = existingItem.id;
						if (existingItem.isDeleted === 1) {
							db.prepare(`
								UPDATE watchlist SET isDeleted = 0, stockName = ?, sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') WHERE id = ?
							`).run(stock.stockName, nextOrder, watchlistId);
						} else {
							db.prepare(`
								UPDATE watchlist SET stockName = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') WHERE id = ?
							`).run(stock.stockName, watchlistId);
						}
					} else {
						watchlistId = randomUUID();
						db.prepare(`
							INSERT INTO watchlist (id, userId, stockCode, stockName, exchange, market, sortOrder)
							VALUES (?, ?, ?, ?, ?, ?, ?)
						`).run(watchlistId, uId, stock.stockCode, stock.stockName, stock.exchange, stock.market, nextOrder);
					}
					results.push(watchlistId);
				}

				if (ctx.runtime && args.stocks.length > 0) {
					if (!args.stocks[0].industry && !args.stocks[0].theme) {
						watchlistLogic.getBatchStockClassification(ctx.runtime, args.stocks, uId)
							.then(batchResults => {
								const db2 = getDB();
								batchResults.forEach((res, i) => {
									if (res) {
										updateWatchlistTags(db2, results[i], uId, res.industry, res.theme);
									}
								});
							}).catch(err => console.error("[Watchlist] 批量自动分类失败:", err));
					} else {
						const db2 = getDB();
						args.stocks.forEach((s, i) => {
							updateWatchlistTags(db2, results[i], uId, s.industry, s.theme);
						});
					}
				}

				db.exec("COMMIT");
				return JSON.stringify({ success: true, ids: results });
			} catch (e: any) {
				db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	get_watchlist: {
		name: "get_watchlist",
		description: "获取自选股列表",
		parameters: GetWatchlistParamsSchema,
		execute: async (args: GetWatchlistParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				let query: string;
				let params: any[] = [uId];

				if (args.categoryId && args.categoryType) {
					const table = args.categoryType === "industry" ? "watchlist_industry_items" : "watchlist_theme_items";
					query = `
						SELECT w.*, ci.weight as relWeight
						FROM watchlist w
						JOIN ${table} ci ON w.id = ci.watchlistId
						WHERE w.userId = ? AND w.isDeleted = 0 AND ci.categoryId = ?
						ORDER BY ci.weight DESC, w.sortOrder ASC
					`;
					params.push(args.categoryId);
				} else {
					query = `
						SELECT w.*, (
							SELECT MAX(total.weight) FROM (
								SELECT weight FROM watchlist_industry_items WHERE watchlistId = w.id
								UNION ALL
								SELECT weight FROM watchlist_theme_items WHERE watchlistId = w.id
								UNION ALL
								SELECT 0 as weight
							) total
						) as globalWeight
						FROM watchlist w
						WHERE w.userId = ? AND w.isDeleted = 0
						ORDER BY globalWeight DESC, w.sortOrder ASC
					`;
				}

				const stocks = db.prepare(query).all(...params) as WatchlistRow[];
				const fullList = stocks.map(stock => {
					const industries = db.prepare(`
						SELECT c.name FROM watchlist_categories c
						JOIN watchlist_industry_items i ON c.id = i.categoryId
						WHERE i.watchlistId = ? ORDER BY i.weight DESC
					`).all(stock.id) as { name: string }[];
					const themes = db.prepare(`
						SELECT c.name FROM watchlist_categories c
						JOIN watchlist_theme_items t ON c.id = t.categoryId
						WHERE t.watchlistId = ? ORDER BY t.weight DESC
					`).all(stock.id) as { name: string }[];
					return {
						...stock,
						industries: industries.map(i => i.name),
						themes: themes.map(t => t.name)
					};
				});
				return JSON.stringify({ success: true, data: fullList });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	get_thematic_dashboard: {
		name: "get_thematic_dashboard",
		description: "获取聚合后的主题/行业看板数据",
		parameters: z.object({}),
		execute: async (_args: {}, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const industryData = db.prepare(`
					SELECT c.name as category_name, i.weight, w.stockCode
					FROM watchlist_categories c
					JOIN watchlist_industry_items i ON c.id = i.categoryId
					JOIN watchlist w ON i.watchlistId = w.id
					WHERE i.userId = ? AND w.isDeleted = 0
				`).all(uId) as any[];
				const themeData = db.prepare(`
					SELECT c.name as category_name, t.weight, w.stockCode
					FROM watchlist_categories c
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
					if (!existing.stocks.includes(item.stockCode)) {
						existing.stocks.push(item.stockCode);
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
		execute: async (_args: {}, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const industries = db.prepare(`
					SELECT DISTINCT c.id, c.name, c.type, c.sortOrder
					FROM watchlist_categories c
					JOIN watchlist_industry_items i ON c.id = i.categoryId
					WHERE i.userId = ?
					ORDER BY c.sortOrder ASC, c.name ASC
				`).all(uId) as any[];
				const themes = db.prepare(`
					SELECT DISTINCT c.id, c.name, c.type, c.sortOrder
					FROM watchlist_categories c
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
		execute: async (_args: {}, ctx: { userId: string, runtime?: PluginRuntime }) => {
			if (!ctx.runtime) return JSON.stringify({ success: false, error: "Runtime not available" });
			const db = getDB();
			const uId = String(ctx.userId);
			try {
				const stocks = db.prepare("SELECT stockCode as code, stockName as name FROM watchlist WHERE userId = ? AND isDeleted = 0").all(uId) as any[];
				if (stocks.length === 0) return JSON.stringify({ success: true, message: "没有可排序的股票" });
				const sortedResults = await watchlistLogic.applySmartSort(ctx.runtime, `sort-${uId}`, stocks);
				if (sortedResults.length > 0) {
					db.exec("BEGIN TRANSACTION");
					const stmt = db.prepare(`
						UPDATE watchlist SET sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
						WHERE userId = ? AND stockCode = ? AND isDeleted = 0
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
		execute: async (args: SyncCategoriesParams, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				if (args.industries) {
					for (const name of args.industries) {
						db.prepare(`
							INSERT INTO watchlist_categories (id, remoteId, userId, name, type, weight, sortOrder)
							VALUES (?, ?, ?, ?, 'industry', 0, 0)
							ON CONFLICT(userId, remoteId) DO UPDATE SET name = excluded.name, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
							ON CONFLICT(userId, name, type) DO UPDATE SET remoteId = excluded.remoteId, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
						`).run(randomUUID(), name, uId, name);
					}
				}
				if (args.themes) {
					for (const name of args.themes) {
						db.prepare(`
							INSERT INTO watchlist_categories (id, remoteId, userId, name, type, weight, sortOrder)
							VALUES (?, ?, ?, ?, 'theme', 0, 0)
							ON CONFLICT(userId, remoteId) DO UPDATE SET name = excluded.name, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
							ON CONFLICT(userId, name, type) DO UPDATE SET remoteId = excluded.remoteId, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
						`).run(randomUUID(), name, uId, name);
					}
				}
				db.exec("COMMIT");
				return JSON.stringify({ success: true });
			} catch (e: any) {
				db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	batch_update_sort_orders: {
		name: "batch_update_sort_orders",
		description: "批量更新排序",
		parameters: BatchUpdateSortOrdersParamsSchema,
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
		execute: async (_args: {}, ctx: { userId: string, runtime?: PluginRuntime }) => {
			if (!ctx.runtime) return JSON.stringify({ success: false, error: "Runtime not available" });
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				db.prepare("DELETE FROM watchlist_industry_items WHERE userId = ?").run(uId);
				db.prepare("DELETE FROM watchlist_theme_items WHERE userId = ?").run(uId);
				const stocks = db.prepare("SELECT stockName, stockCode, exchange FROM watchlist WHERE userId = ? AND isDeleted = 0").all(uId) as any[];
				if (stocks.length > 0) {
					watchlistLogic.getBatchStockClassification(ctx.runtime, stocks, uId)
						.then(batchResults => {
							const db2 = getDB();
							const userStocks = db2.prepare("SELECT id, stockCode, exchange FROM watchlist WHERE userId = ? AND isDeleted = 0").all(uId) as any[];
							batchResults.forEach((res, i) => {
								if (res) {
									const s = stocks[i];
									const match = userStocks.find(us => us.stockCode === s.stockCode && us.exchange === s.exchange);
									if (match) {
										const cats = [
											{ name: res.industry.name, type: 'industry' as const, weight: res.industry.weight },
											...res.theme.map((t: any) => ({ name: t.name, type: 'theme' as const, weight: t.weight }))
										];
										cats.forEach(c => {
											const catId = watchlistLogic._ensureCategory(db2, c.name, c.type, uId);
											if (catId) {
												const table = c.type === 'industry' ? 'watchlist_industry_items' : 'watchlist_theme_items';
												db2.prepare(`INSERT OR IGNORE INTO ${table} (id, watchlistId, userId, categoryId, weight) VALUES (?, ?, ?, ?, ?)`).run(randomUUID(), match.id, uId, catId, c.weight);
											}
										});
									}
								}
							});
						}).catch(err => console.error("[Watchlist] 重置分类失败:", err));
				}
				db.exec("COMMIT");
				return JSON.stringify({ success: true, message: "重置分类请求已提交" });
			} catch (e: any) {
				db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	}
};