// src/watchlist.ts
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDbPath } from "./runtime";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
	AddToWatchlistParams,
	AddToWatchlistParamsSchema,
	UpdateWatchlistItemParams,
	UpdateWatchlistItemSchema
} from "./watchlistType";

let _db: any = null;

const ExchangeEnum = z.enum(["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]);
const MarketEnum = z.enum(["A_SHARE", "US_SHARE", "HK_SHARE", "FUTURES", "FUND", "OTHER"]);

function getDB() {
	if (!_db) {
		const dbPath = getDbPath();
		mkdirSync(path.dirname(dbPath), { recursive: true });
		_db = new DatabaseSync(dbPath);
		_db.exec("PRAGMA journal_mode = WAL");
		_db.exec("PRAGMA synchronous = NORMAL");

		_db.exec(`
        CREATE TABLE IF NOT EXISTS watchlist (
						id         TEXT PRIMARY KEY,
						userId     TEXT NOT NULL,
						stockCode  TEXT NOT NULL,
						exchange   TEXT NOT NULL,
						market     TEXT NOT NULL,
						stockName  TEXT NOT NULL,
						sortOrder  REAL DEFAULT 0,
						isDeleted  INTEGER DEFAULT 0 CHECK (isDeleted IN (0, 1)),
            createdAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
            updatedAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
            UNIQUE(userId, stockCode, exchange)
            );

        CREATE INDEX IF NOT EXISTS idx_watchlist_main
            ON watchlist(userId, isDeleted, sortOrder DESC);
		`);
	}
	return _db;
}


export const watchlistTools = {
	add_to_watchlist: {
		name: "add_to_watchlist",
		description: "添加股票到自选列表",
		parameters: AddToWatchlistParamsSchema,
		execute: async (args: AddToWatchlistParams, ctx: { userId: string }) => {
			const db = getDB();
			const uId = String(ctx.userId);
			const newUuid = randomUUID();

			const row = db.prepare("SELECT MAX(sortOrder) as max FROM watchlist WHERE userId=? AND isDeleted=0").get(uId) as any;
			const nextOrder = (row?.max ?? 0) + 1024;

			try {
				db.prepare(`
            INSERT INTO watchlist (id, userId, stockCode, stockName, exchange, market, sortOrder)
            VALUES (?, ?, ?, ?, ?, ?, ?)
				`).run(newUuid, uId, args.stockCode, args.stockName, args.exchange, args.market, nextOrder);
				return JSON.stringify({ success: true, action: "ADD", id: newUuid });
			} catch (e: any) {
				if (e.message.includes("UNIQUE constraint failed")) {
					// 恢复逻辑：依然根据业务键找回原来的 ID
					db.prepare(`
              UPDATE watchlist
              SET isDeleted=0,
                  sortOrder=?,
                  updatedAt=STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')
              WHERE userId = ?
                AND stockCode = ?
                AND exchange = ?
					`).run(nextOrder, uId, args.stockCode, args.exchange);

					const existing = db.prepare("SELECT id FROM watchlist WHERE userId=? AND stockCode=? AND exchange=?").get(uId, args.stockCode, args.exchange) as any;
					return JSON.stringify({ success: true, action: "RESTORE", id: existing?.id });
				}
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	update_watchlist_item: {
		name: "update_watchlist_item",
		description: "更新自选股属性(如改名或微调排序)",
		parameters: UpdateWatchlistItemSchema,
		execute: async (args: UpdateWatchlistItemParams, ctx: { userId: string }) => {
			const info = getDB().prepare(`
          UPDATE watchlist
          SET stockName = COALESCE(?, stockName),
              sortOrder = COALESCE(?, sortOrder),
              updatedAt = STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')
          WHERE id = ?
            AND userId = ?
            AND isDeleted = 0
			`).run(args.stockName ?? null, args.sortOrder ?? null, args.id, String(ctx.userId));
			return JSON.stringify({ success: info.changes > 0 });
		}
	},

	remove_from_watchlist: {
		name: "remove_from_watchlist",
		description: "将股票从自选列表中移除",
		parameters: z.object({ id: z.string() }),
		execute: async (args: { id: string }, ctx: { userId: string }) => {
			const info = getDB().prepare(`
          UPDATE watchlist
          SET isDeleted = 1,
              updatedAt = STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')
          WHERE id = ?
            AND userId = ?
            AND isDeleted = 0
			`).run(args.id, String(ctx.userId));
			return JSON.stringify({ success: info.changes > 0 });
		}
	},

	get_watchlist: {
		name: "get_watchlist",
		description: "获取当前用户的自选股列表",
		parameters: z.object({}),
		execute: async (_args: {}, ctx: { userId: string }) => {
			const list = getDB().prepare(`
          SELECT
              id,
              userId,
              stockCode,
              exchange,
              market,
              stockName,
              sortOrder,
              createdAt,
              updatedAt
          FROM watchlist
          WHERE userId = ?
            AND isDeleted = 0
          ORDER BY sortOrder DESC, createdAt DESC
			`).all(String(ctx.userId));
			return JSON.stringify({ success: true, data: list });
		}
	},

	// 批量排序：传入 ID 数组
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
                updatedAt = STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')
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
	}
};
