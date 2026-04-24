import { randomUUID } from "node:crypto";
// @ts-ignore
import { DatabaseSync } from "node:sqlite";
import { z } from "openclaw/plugin-sdk/zod";
import { getDB } from "../../core/database";
import {
	AddToWatchlistParams,
	AddToWatchlistParamsSchema,
	UpdateWatchlistItemParams,
	UpdateWatchlistItemSchema
} from "./schema";

interface CategoryRow {
	id: string;
	name: string;
	type?: string;
	weight?: number;
}

interface WatchlistRow {
	id: string;
	isDeleted: number;
	sortOrder: number;
	stockName: string;
}

/**
 * 辅助函数：通过名字获取分类 ID
 */
function getCategoryIdByName(db: DatabaseSync, userId: string, name: string, type: 'industry' | 'theme'): string | undefined {
	const row = db.prepare("SELECT id FROM watchlist_categories WHERE userId = ? AND name = ? AND type = ?").get(userId, name, type) as CategoryRow | undefined;
	return row?.id;
}

/**
 * 辅助函数：统一处理归一化分类项 (支持 string | object)
 */
function normalizeTags(input: any): { name: string, weight: number }[] {
	if (!input) return [];
	const items = Array.isArray(input) ? input : [input];
	return items.map(item => {
		if (typeof item === 'string') return { name: item, weight: 0 };
		if (typeof item === 'object' && item !== null && 'name' in item) {
			return { name: item.name as string, weight: (item as any).weight ?? 0 };
		}
		return null;
	}).filter((i): i is { name: string, weight: number } => i !== null);
}

/**
 * 辅助函数：更新股票的分类标签
 */
function updateWatchlistTags(db: DatabaseSync, watchlistId: string, userId: string, industry: any, theme: any) {
	const normIndustries = normalizeTags(industry);
	for (const item of normIndustries) {
		const categoryId = getCategoryIdByName(db, userId, item.name, 'industry');
		if (categoryId) {
			db.prepare(`
				INSERT OR IGNORE INTO watchlist_industry_items (id, watchlistId, userId, categoryId, weight)
				VALUES (?, ?, ?, ?, ?)
			`).run(randomUUID(), watchlistId, userId, categoryId, item.weight);
		}
	}

	const normThemes = normalizeTags(theme);
	for (const item of normThemes) {
		const categoryId = getCategoryIdByName(db, userId, item.name, 'theme');
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
		execute: async (args: AddToWatchlistParams, ctx: { userId: string }) => {
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

				updateWatchlistTags(db, watchlistId, uId, args.industry, args.theme);
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
		execute: async (args: { stocks: AddToWatchlistParams[] }, ctx: { userId: string }) => {
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
					const existingItem = db.prepare("SELECT id, isDeleted FROM watchlist WHERE userId = ? AND stockCode = ? AND exchange = ?").get([uId, stock.stockCode, stock.exchange]) as WatchlistRow | undefined;

					if (existingItem) {
						watchlistId = existingItem.id;
						if (existingItem.isDeleted === 1) {
							db.prepare(`
								UPDATE watchlist SET isDeleted = 0, stockName = ?, sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') WHERE id = ?
							`).run([stock.stockName, nextOrder, watchlistId]);
						} else {
							db.prepare(`
								UPDATE watchlist SET stockName = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW') WHERE id = ?
							`).run([stock.stockName, watchlistId]);
						}
					} else {
						watchlistId = randomUUID();
						db.prepare(`
							INSERT INTO watchlist (id, userId, stockCode, stockName, exchange, market, sortOrder)
							VALUES (?, ?, ?, ?, ?, ?, ?)
						`).run([watchlistId, uId, stock.stockCode, stock.stockName, stock.exchange, stock.market, nextOrder]);
					}

					updateWatchlistTags(db, watchlistId, uId, stock.industry, stock.theme);
					results.push(watchlistId);
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
		description: "获取自选股列表（支持按维度过滤）",
		parameters: z.object({
			categoryId: z.string().optional().describe("分类 ID，不传返回所有"),
			categoryType: z.enum(["industry", "theme"]).optional().describe("分类类型")
		}),
		execute: async (args: { categoryId?: string, categoryType?: "industry" | "theme" }, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);

				let query: string;
				let params: any[] = [uId];

				if (args.categoryId && args.categoryType) {
					// 过滤查询
					const table = args.categoryType === "industry" ? "watchlist_industry_items" : "watchlist_theme_items";
					query = `
						SELECT w.*, ci.weight as relWeight
						FROM watchlist w
						JOIN ${table} ci ON w.id = ci.watchlistId
						WHERE w.userId = ? AND w.isDeleted = 0 AND ci.categoryId = ?
						ORDER BY ci.weight DESC, w.sortOrder DESC
					`;
					params.push(args.categoryId);
				} else {
					// 【方案 B】全量查询：按全局最高权重分排序
					// 计算每只股票在所有行业和主题中获得的最大权重
					query = `
						SELECT w.*, (
							SELECT MAX(total.weight) FROM (
								SELECT weight FROM watchlist_industry_items WHERE watchlistId = w.id
								UNION ALL
								SELECT weight FROM watchlist_theme_items WHERE watchlistId = w.id
								UNION ALL
								SELECT 0 as weight -- 兜底，防止没有任何分类时 weight 为空
							) total
						) as globalWeight
						FROM watchlist w
						WHERE w.userId = ? AND w.isDeleted = 0
						ORDER BY globalWeight DESC, w.sortOrder DESC, w.createdAt DESC
					`;
				}

				const stocks = db.prepare(query).all(...params) as WatchlistRow[];

				// 补全分类名字（无论结果是什么，都带上所属维度，方便前端展示）
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

	get_watchlist_tabs: {
		name: "get_watchlist_tabs",
		description: "获取自选股的有效分类页签",
		parameters: z.object({}),
		execute: async (_args: {}, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);

				// 1. 获取有股票的行业
				const industries = db.prepare(`
					SELECT DISTINCT c.id, c.name, c.type, c.weight
					FROM watchlist_categories c
					JOIN watchlist_industry_items i ON c.id = i.categoryId
					WHERE i.userId = ?
					ORDER BY c.weight DESC, c.name ASC
				`).all(uId) as any[];

				// 2. 获取有股票的主题
				const themes = db.prepare(`
					SELECT DISTINCT c.id, c.name, c.type, c.weight
					FROM watchlist_categories c
					JOIN watchlist_theme_items t ON c.id = t.categoryId
					WHERE t.userId = ?
					ORDER BY c.weight DESC, c.name ASC
				`).all(uId) as any[];

				// 组装 Tab 列表
				const tabs = [
					{ id: "all", name: "所有", type: "all" },
					...industries.map(i => ({ id: i.id, name: i.name, type: "industry" })),
					...themes.map(t => ({ id: t.id, name: t.name, type: "theme" }))
				];

				return JSON.stringify({ success: true, data: tabs });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	sync_watchlist_categories: {
		name: "sync_watchlist_categories",
		description: "同步行业或主题分类字典数据",
		parameters: z.object({
			industries: z.array(z.object({
				remoteId: z.string(),
				name: z.string(),
				weight: z.number().optional()
			})).optional(),
			themes: z.array(z.object({
				remoteId: z.string(),
				name: z.string(),
				weight: z.number().optional()
			})).optional()
		}),
		execute: async (args: { industries?: any[], themes?: any[] }, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				// 处理行业同步
				if (args.industries) {
					for (const ind of args.industries) {
						db.prepare(`
							INSERT INTO watchlist_categories (id, remoteId, userId, name, type, weight)
							VALUES (?, ?, ?, ?, 'industry', ?)
							ON CONFLICT(userId, remoteId) DO UPDATE SET
								name = excluded.name,
								weight = excluded.weight,
								updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
							ON CONFLICT(userId, name, type) DO UPDATE SET
								remoteId = excluded.remoteId,
								weight = excluded.weight
						`).run(randomUUID(), String(ind.remoteId), uId, ind.name, ind.weight ?? 0);
					}
				}
				// 处理主题同步
				if (args.themes) {
					for (const thm of args.themes) {
						db.prepare(`
							INSERT INTO watchlist_categories (id, remoteId, userId, name, type, weight)
							VALUES (?, ?, ?, ?, 'theme', ?)
							ON CONFLICT(userId, remoteId) DO UPDATE SET
								name = excluded.name,
								weight = excluded.weight
							ON CONFLICT(userId, name, type) DO UPDATE SET
								remoteId = excluded.remoteId,
								weight = excluded.weight
						`).run(randomUUID(), String(thm.remoteId), uId, thm.name, thm.weight ?? 0);
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
		description: "根据顺序批量更新排序",
		parameters: z.object({ orderedIds: z.array(z.string()) }),
		execute: async (args: { orderedIds: string[] }, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				const stmt = db.prepare(`
            UPDATE watchlist SET sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
            WHERE id = ? AND userId = ? AND isDeleted = 0
				`);
				args.orderedIds.forEach((id, i) => {
					const weight = (args.orderedIds.length - i) * 1024;
					stmt.run(weight, id, uId);
				});
				db.exec("COMMIT");
				return JSON.stringify({ success: true });
			} catch (e: any) {
				db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	}
};