import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDB } from "../../core/database";
import { getOrCreateDefaultGroup, ensureStockInGroup } from "./store";
import {
	AddToWatchlistParams,
	AddToWatchlistParamsSchema,
	UpdateWatchlistItemParams,
	UpdateWatchlistItemSchema,
	CreateWatchlistGroupParams,
	CreateWatchlistGroupSchema,
	UpdateWatchlistGroupParams,
	UpdateWatchlistGroupSchema
} from "./schema";

export const watchlistTools = {
	add_to_watchlist: {
		name: "add_to_watchlist",
		description: "添加股票到自选列表",
		parameters: AddToWatchlistParamsSchema,
		execute: async (args: AddToWatchlistParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);

				const allGroupId = getOrCreateDefaultGroup(db, uId);

				const row = db.prepare("SELECT MAX(sortOrder) as max FROM watchlist WHERE userId=? AND isDeleted=0").get(uId) as any;
				const nextOrder = (row?.max ?? 0) + 1024;

				let watchlistId: string;
				const existingItem = db.prepare("SELECT id, isDeleted FROM watchlist WHERE userId = ? AND stockCode = ? AND exchange = ?").get(uId, args.stockCode, args.exchange) as any;

				if (existingItem) {
					watchlistId = existingItem.id;

					if (existingItem.isDeleted === 1) {
						db.prepare(`
							UPDATE watchlist 
							SET isDeleted = 0, stockName = ?, sortOrder = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
							WHERE id = ?
						`).run(args.stockName, nextOrder, watchlistId);
					} else {
						db.prepare(`
							UPDATE watchlist 
							SET stockName = ?, updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
							WHERE id = ?
						`).run(args.stockName, watchlistId);
					}
				} else {
					watchlistId = randomUUID();

					db.prepare(`
						INSERT INTO watchlist (id, userId, stockCode, stockName, exchange, market, sortOrder)
						VALUES (?, ?, ?, ?, ?, ?, ?)
					`).run(watchlistId, uId, args.stockCode, args.stockName, args.exchange, args.market, nextOrder);
				}

				ensureStockInGroup(db, watchlistId, allGroupId, uId);

				if (args.groupIds && Array.isArray(args.groupIds)) {
					for (const gId of args.groupIds) {
						if (gId !== allGroupId) {
							ensureStockInGroup(db, watchlistId, gId, uId);
						}
					}
				}

				return JSON.stringify({ success: true, id: watchlistId });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	update_watchlist_item: {
		name: "update_watchlist_item",
		description: "更新自选股属性(如改名、微调排序、调整分组)",
		parameters: UpdateWatchlistItemSchema,
		execute: async (args: UpdateWatchlistItemParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);

				const info = db.prepare(`
          UPDATE watchlist
          SET stockName = COALESCE(?, stockName),
              sortOrder = COALESCE(?, sortOrder),
              updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
          WHERE id = ?
            AND userId = ?
            AND isDeleted = 0
				`).run(args.stockName ?? null, args.sortOrder ?? null, args.id, uId);

				if (info.changes === 0) {
					return JSON.stringify({ success: false, error: "Item not found or already deleted." });
				}

				if (args.groupIds && Array.isArray(args.groupIds)) {
					const allGroupId = getOrCreateDefaultGroup(db, uId);
					db.exec("BEGIN TRANSACTION");
					try {
						db.prepare(`
							DELETE FROM watchlist_group_items 
							WHERE watchlistId = ? AND userId = ? AND groupId != ?
						`).run(args.id, uId, allGroupId);

						for (const gId of args.groupIds) {
							if (gId !== allGroupId) {
								ensureStockInGroup(db, args.id, gId, uId);
							}
						}
						db.exec("COMMIT");
					} catch (e) {
						db.exec("ROLLBACK");
						throw e;
					}
				}

				return JSON.stringify({ success: true });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	remove_from_watchlist: {
		name: "remove_from_watchlist",
		description: "将股票从自选列表中移除",
		parameters: z.object({ id: z.string() }),
		execute: async (args: { id: string }, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);

			db.exec("BEGIN TRANSACTION");
			try {
				const info = db.prepare(`
					UPDATE watchlist
					SET isDeleted = 1,
						updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
					WHERE id = ?
					  AND userId = ?
					  AND isDeleted = 0
				`).run(args.id, uId);

				if (info.changes > 0) {
					db.prepare(`
						DELETE FROM watchlist_group_items 
						WHERE watchlistId = ? AND userId = ?
					`).run(args.id, uId);
				}

				db.exec("COMMIT");
				return JSON.stringify({ success: info.changes > 0 });
			} catch (e: any) {
				db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	get_watchlist: {
		name: "get_watchlist",
		description: "获取当前用户的自选股列表",
		parameters: z.object({
			groupId: z.string().optional()
		}),
		execute: async (args: { groupId?: string }, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);

				const allGroupId = getOrCreateDefaultGroup(db, uId);
				const targetGroupId = args.groupId || allGroupId;

				let query: string;
				const params: any[] = [uId];

				if (targetGroupId === allGroupId) {
					query = `
						SELECT w.id, w.userId, w.stockCode, w.exchange, w.market, w.stockName, w.sortOrder, w.createdAt, w.updatedAt
						FROM watchlist w
						WHERE w.userId = ? AND w.isDeleted = 0
					`;
				} else {
					query = `
						SELECT w.id, w.userId, w.stockCode, w.exchange, w.market, w.stockName, w.sortOrder, w.createdAt, w.updatedAt
						FROM watchlist w
						JOIN watchlist_group_items i ON w.id = i.watchlistId
						WHERE w.userId = ? AND w.isDeleted = 0 AND i.groupId = ?
					`;
					params.push(targetGroupId);
				}

				query += " ORDER BY w.sortOrder DESC, w.createdAt DESC ";

				const list = db.prepare(query).all(...params);
				return JSON.stringify({ success: true, data: list });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	batch_update_sort_orders: {
		name: "batch_update_sort_orders",
		description: "根据拖拽后的 ID 顺序批量更新排序",
		parameters: z.object({
			orderedIds: z.array(z.string())
		}),
		execute: async (args: { orderedIds: string[] }, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				const stmt = db.prepare(`
            UPDATE watchlist
            SET sortOrder = ?,
                updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
            WHERE id = ?
              AND userId = ?
              AND isDeleted = 0
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
	},

	batch_update_group_sort_orders: {
		name: "batch_update_group_sort_orders",
		description: "根据拖拽后的 ID 顺序批量更新分组排序",
		parameters: z.object({
			orderedIds: z.array(z.string())
		}),
		execute: async (args: { orderedIds: string[] }, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			db.exec("BEGIN TRANSACTION");
			try {
				const stmt = db.prepare(`
            UPDATE watchlist_groups
            SET sortOrder = ?,
                updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
            WHERE id = ?
              AND userId = ?
				`);
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

	get_watchlist_groups: {
		name: "get_watchlist_groups",
		description: "获取当前用户的自选股分组列表",
		parameters: z.object({}),
		execute: async (_args: {}, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				getOrCreateDefaultGroup(db, uId);
				const list = db.prepare(`
          SELECT id, name, sortOrder, createdAt, updatedAt
          FROM watchlist_groups
          WHERE userId = ?
          ORDER BY sortOrder ASC, createdAt ASC
				`).all(uId);
				return JSON.stringify({ success: true, data: list });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	create_watchlist_group: {
		name: "create_watchlist_group",
		description: "创建新的自选股分组",
		parameters: CreateWatchlistGroupSchema,
		execute: async (args: CreateWatchlistGroupParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const newUuid = randomUUID();
				const row = db.prepare("SELECT MAX(sortOrder) as max FROM watchlist_groups WHERE userId=?").get(uId) as any;
				const nextOrder = (row?.max ?? 0) + 1024;

				db.prepare(`
          INSERT INTO watchlist_groups (id, userId, name, sortOrder)
          VALUES (?, ?, ?, ?)
				`).run(newUuid, uId, args.name, nextOrder);
				return JSON.stringify({ success: true, id: newUuid });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	update_watchlist_group: {
		name: "update_watchlist_group",
		description: "更新自选股分组属性(如重命名或调整排序)",
		parameters: UpdateWatchlistGroupSchema,
		execute: async (args: UpdateWatchlistGroupParams, ctx: { userId: string }) => {
			try {
				const info = getDB().prepare(`
          UPDATE watchlist_groups
          SET name = COALESCE(?, name),
              sortOrder = COALESCE(?, sortOrder),
              updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
          WHERE id = ?
            AND userId = ?
				`).run(args.name ?? null, args.sortOrder ?? null, args.id, String(ctx.userId));
				return JSON.stringify({ success: info.changes > 0 });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	delete_watchlist_group: {
		name: "delete_watchlist_group",
		description: "删除自选股分组 (不会删除股票，只是该分组消失)",
		parameters: z.object({ id: z.string() }),
		execute: async (args: { id: string }, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);

			const group = db.prepare("SELECT name FROM watchlist_groups WHERE id = ?").get(args.id) as any;
			if (group?.name === "全部") {
				return JSON.stringify({ success: false, error: "Cannot delete default group '全部'" });
			}

			db.exec("BEGIN TRANSACTION");
			try {
				db.prepare(`
            DELETE FROM watchlist_groups
            WHERE id = ? AND userId = ?
				`).run(args.id, uId);

				db.prepare(`DELETE FROM watchlist_group_items WHERE groupId = ? AND userId = ?`).run(args.id, uId);

				db.exec("COMMIT");
				return JSON.stringify({ success: true });
			} catch (e: any) {
				db.exec("ROLLBACK");
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	remove_from_watchlist_group: {
		name: "remove_from_watchlist_group",
		description: "将股票从特定分组中移除 (不会从自选大列表中删除)",
		parameters: z.object({ id: z.string(), groupId: z.string() }),
		execute: async (args: { id: string, groupId: string }, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);

				const group = db.prepare("SELECT name FROM watchlist_groups WHERE id = ?").get(args.groupId) as any;
				if (group?.name === "全部") {
					return JSON.stringify({ success: false, error: "Cannot remove from '全部' group individually. Use remove_from_watchlist to delete from all groups." });
				}

				const info = db.prepare(`
					DELETE FROM watchlist_group_items 
					WHERE watchlistId = ? AND groupId = ? AND userId = ?
				`).run(args.id, args.groupId, uId);

				return JSON.stringify({ success: info.changes > 0 });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	}
};