import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import {
	AddStockNoteParams,
	AddStockNoteParamsSchema,
	DeleteStockNoteParams,
	DeleteStockNoteParamsSchema,
	GetStockNoteByIdParams,
	GetStockNoteByIdParamsSchema,
	QueryStockNotesParams,
	QueryStockNotesParamsSchema,
	StockNote,
	StockNoteProfileLibraryRow,
	StockNoteRow,
	UpdateStockNoteParams,
	UpdateStockNoteParamsSchema
} from "./schema.js";

interface RuntimeTool {
	name: string;
	description: string;
	parameters: unknown;
	registerTool?: boolean;
	execute(params: unknown, ctx: { userId: string }): Promise<string>;
}

interface WatchlistStock {
	id: string;
	stockCode: string;
	stockName: string;
	exchange: string;
	market: string;
}

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function normalizePagination(args: { page?: number; pageSize?: number }) {
	const page = args.page ?? 1;
	const pageSize = args.pageSize ?? 20;
	return {
		page,
		pageSize,
		offset: (page - 1) * pageSize
	};
}

function uniqueIds(ids: string[] | undefined): string[] {
	return Array.from(new Set((ids || []).map(id => id.trim()).filter(Boolean)));
}

function runInTransaction<T>(db: ReturnType<typeof getDB>, task: () => T): T {
	const savepoint = `note_tx_${randomUUID().replace(/-/g, "")}`;
	db.exec(`SAVEPOINT ${savepoint}`);
	try {
		const result = task();
		db.exec(`RELEASE SAVEPOINT ${savepoint}`);
		return result;
	} catch (e) {
		db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
		db.exec(`RELEASE SAVEPOINT ${savepoint}`);
		throw e;
	}
}

function getNoteSelectSql(whereSql: string): string {
	return `
		SELECT
			sn.id,
			sn.watchlistId,
			w.stockCode,
			w.stockName,
			w.exchange,
			w.market,
			sn.note,
			sn.createdAt,
			sn.updatedAt
		FROM stock_notes sn
		JOIN watchlist w ON w.id = sn.watchlistId AND w.userId = sn.userId
		WHERE ${whereSql}
	`;
}

function resolveWatchlistStock(
	db: ReturnType<typeof getDB>,
	userId: string,
	args: { watchlistId?: string; stockCode?: string; exchange?: string }
): WatchlistStock | null {
	if (args.watchlistId) {
		return db.prepare(`
			SELECT id, stockCode, stockName, exchange, market
			FROM watchlist
			WHERE id = ? AND userId = ? AND isDeleted = 0
		`).get(args.watchlistId.trim(), userId) as WatchlistStock | undefined || null;
	}

	if (args.stockCode && args.exchange) {
		return db.prepare(`
			SELECT id, stockCode, stockName, exchange, market
			FROM watchlist
			WHERE userId = ? AND stockCode = ? AND exchange = ? AND isDeleted = 0
		`).get(userId, args.stockCode.trim(), args.exchange) as WatchlistStock | undefined || null;
	}

	return null;
}

function getMissingProfileLibraryIds(db: ReturnType<typeof getDB>, userId: string, ids: string[]): string[] {
	if (ids.length === 0) return [];
	const existing = db.prepare(`
		SELECT id
		FROM profile_libraries
		WHERE userId = ? AND id IN (${ids.map(() => "?").join(",")})
	`).all(userId, ...ids) as { id: string }[];
	const existingIds = new Set(existing.map(row => row.id));
	return ids.filter(id => !existingIds.has(id));
}

function ensureProfileLibrariesExist(db: ReturnType<typeof getDB>, userId: string, ids: string[]) {
	if (ids.length === 0) return;
	const missing = getMissingProfileLibraryIds(db, userId, ids);
	if (missing.length === 0) return;

	const insert = db.prepare(`
		INSERT INTO profile_libraries (id, userId, title, createdAt, updatedAt)
		VALUES (?, ?, ?, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'), STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
		ON CONFLICT(id, userId) DO NOTHING
	`);
	for (const id of missing) {
		const isReport = id.startsWith("report-");
		const isAnn = id.startsWith("announcement-");
		const defaultTitle = isReport ? `研报 ${id}` : (isAnn ? `公告 ${id}` : `资料 ${id}`);
		insert.run(id, userId, defaultTitle);
	}
}

function attachProfileLibraries(db: ReturnType<typeof getDB>, userId: string, rows: StockNoteRow[]): StockNote[] {
	if (rows.length === 0) return [];
	const noteIds = rows.map(row => row.id);
	const libraryRows = db.prepare(`
		SELECT npl.noteId, pl.id, pl.title
		FROM stock_note_profile_libraries npl
		JOIN profile_libraries pl ON pl.id = npl.profileLibraryId AND pl.userId = npl.userId
		WHERE npl.userId = ? AND npl.noteId IN (${noteIds.map(() => "?").join(",")})
		ORDER BY npl.noteId, npl.createdAt ASC
	`).all(userId, ...noteIds) as StockNoteProfileLibraryRow[];

	const librariesByNoteId = new Map<string, { id: string; title: string }[]>();
	for (const row of libraryRows) {
		const list = librariesByNoteId.get(row.noteId) || [];
		list.push({ id: row.id, title: row.title });
		librariesByNoteId.set(row.noteId, list);
	}

	return rows.map(row => {
		const libs = librariesByNoteId.get(row.id) || [];
		return {
			...row,
			profileLibraries: libs
		};
	});
}

function successWithPagination(data: StockNote[], page: number, pageSize: number, total: number) {
	return JSON.stringify({
		success: true,
		data,
		pagination: {
			page,
			pageSize,
			total,
			totalPages: Math.ceil(total / pageSize)
		}
	});
}

export const noteTools: Record<string, RuntimeTool> = {
	add_stock_note: {
		name: "add_stock_note",
		description: "新增股票笔记，笔记内容 200 字以内，可关联资料库列表",
		parameters: AddStockNoteParamsSchema,
		registerTool: false,
		execute: async (args: AddStockNoteParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const id = randomUUID();
				const stock = resolveWatchlistStock(db, uId, args);
				if (!stock) {
					return JSON.stringify({ success: false, error: "股票不存在或未在自选列表中" });
				}
				const profileLibraryIds = uniqueIds(args.profileLibraryIds);

				runInTransaction(db, () => {
					ensureProfileLibrariesExist(db, uId, profileLibraryIds);
					db.prepare(`
						INSERT INTO stock_notes (id, userId, watchlistId, note)
						VALUES (?, ?, ?, ?)
					`).run(id, uId, stock.id, args.note);

					const insertRelation = db.prepare(`
						INSERT INTO stock_note_profile_libraries (id, noteId, userId, profileLibraryId)
						VALUES (?, ?, ?, ?)
					`);
					profileLibraryIds.forEach((profileLibraryId) => {
						insertRelation.run(randomUUID(), id, uId, profileLibraryId);
					});
				});

				const row = db.prepare(getNoteSelectSql("sn.id = ? AND sn.userId = ?")).get(id, uId) as StockNoteRow;
				return JSON.stringify({ success: true, data: attachProfileLibraries(db, uId, [row])[0] });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	delete_stock_note: {
		name: "delete_stock_note",
		description: "删除股票笔记",
		parameters: DeleteStockNoteParamsSchema,
		registerTool: false,
		execute: async (args: DeleteStockNoteParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const id = args.id.trim();

				const info = runInTransaction(db, () => {
					db.prepare("DELETE FROM stock_note_profile_libraries WHERE noteId = ? AND userId = ?").run(id, uId);
					return db.prepare("DELETE FROM stock_notes WHERE id = ? AND userId = ?").run(id, uId);
				});
				return JSON.stringify({ success: info.changes > 0 });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	update_stock_note: {
		name: "update_stock_note",
		description: "修改股票笔记；传入 profileLibraryIds 时会覆盖原有关联资料库列表",
		parameters: UpdateStockNoteParamsSchema,
		registerTool: false,
		execute: async (args: UpdateStockNoteParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const id = args.id.trim();
				const existing = db.prepare(`
					SELECT id
					FROM stock_notes
					WHERE id = ? AND userId = ?
				`).get(id, uId);
				if (!existing) {
					return JSON.stringify({ success: false, error: "笔记不存在" });
				}

				const stock = (args.watchlistId || args.stockCode || args.exchange)
					? resolveWatchlistStock(db, uId, args)
					: null;
				if ((args.watchlistId || args.stockCode || args.exchange) && !stock) {
					return JSON.stringify({ success: false, error: "股票不存在或未在自选列表中" });
				}
				const profileLibraryIds = args.profileLibraryIds === undefined ? undefined : uniqueIds(args.profileLibraryIds);

				runInTransaction(db, () => {
					if (profileLibraryIds) {
						ensureProfileLibrariesExist(db, uId, profileLibraryIds);
					}
					const updates: string[] = ["updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')"];
					const updateParams: unknown[] = [];
					if (stock) {
						updates.unshift("watchlistId = ?");
						updateParams.push(stock.id);
					}
					if (args.note !== undefined) {
						updates.unshift("note = ?");
						updateParams.unshift(args.note);
					}
					db.prepare(`
						UPDATE stock_notes SET ${updates.join(", ")}
						WHERE id = ? AND userId = ?
					`).run(...updateParams, id, uId);
					if (profileLibraryIds) {
						db.prepare(`
							DELETE FROM stock_note_profile_libraries
							WHERE userId = ? AND noteId = ?
						`).run(uId, id);

						const insertRelation = db.prepare(`
							INSERT INTO stock_note_profile_libraries (id, noteId, userId, profileLibraryId)
							VALUES (?, ?, ?, ?)
						`);
						profileLibraryIds.forEach((profileLibraryId) => {
							insertRelation.run(randomUUID(), id, uId, profileLibraryId);
						});
					}
				});

				const row = db.prepare(getNoteSelectSql("sn.id = ? AND sn.userId = ?")).get(id, uId) as StockNoteRow;
				return JSON.stringify({ success: true, data: attachProfileLibraries(db, uId, [row])[0] });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	get_stock_note_by_id: {
		name: "get_stock_note_by_id",
		description: "根据 ID 查询股票笔记详情",
		parameters: GetStockNoteByIdParamsSchema,
		registerTool: false,
		execute: async (args: GetStockNoteByIdParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const row = db.prepare(getNoteSelectSql("sn.id = ? AND sn.userId = ?")).get(args.id.trim(), uId) as StockNoteRow | undefined;

				return JSON.stringify({ success: true, data: row ? attachProfileLibraries(db, uId, [row])[0] : null });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	query_stock_notes: {
		name: "query_stock_notes",
		description: "分页查询股票笔记，支持按股票代码、交易所和关键词过滤",
		parameters: QueryStockNotesParamsSchema,
		registerTool: false,
		execute: async (args: QueryStockNotesParams = {}, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const { page, pageSize, offset } = normalizePagination(args);
				const conditions = ["sn.userId = ?", "w.isDeleted = 0"];
				const params: unknown[] = [uId];

				if (args.watchlistId) {
					conditions.push("sn.watchlistId = ?");
					params.push(args.watchlistId);
				}
				if (args.stockCode) {
					conditions.push("w.stockCode = ?");
					params.push(args.stockCode);
				}
				if (args.exchange) {
					conditions.push("w.exchange = ?");
					params.push(args.exchange);
				}
				const keyword = args.keyword?.trim();
				if (keyword) {
					const pattern = `%${escapeLikePattern(keyword)}%`;
					conditions.push("(w.stockCode LIKE ? ESCAPE '\\' OR w.stockName LIKE ? ESCAPE '\\' OR sn.note LIKE ? ESCAPE '\\')");
					params.push(pattern, pattern, pattern);
				}

				const whereSql = conditions.join(" AND ");
				const total = (db.prepare(`
					SELECT COUNT(*) AS count
					FROM stock_notes sn
					JOIN watchlist w ON w.id = sn.watchlistId AND w.userId = sn.userId
					WHERE ${whereSql}
				`).get(...params) as { count: number }).count;
				const rows = db.prepare(`${getNoteSelectSql(whereSql)}
					ORDER BY sn.updatedAt DESC, sn.createdAt DESC
					LIMIT ? OFFSET ?
				`).all(...params, pageSize, offset) as StockNoteRow[];

				return successWithPagination(attachProfileLibraries(db, uId, rows), page, pageSize, total);
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	}
};
