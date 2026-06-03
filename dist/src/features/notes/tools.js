import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import { AddStockNoteParamsSchema, DeleteStockNoteParamsSchema, GetStockNoteByIdParamsSchema, QueryStockNotesParamsSchema, UpdateStockNoteParamsSchema } from "./schema.js";
function escapeLikePattern(value) {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
function normalizePagination(args) {
    const page = args.page ?? 1;
    const pageSize = args.pageSize ?? 20;
    return {
        page,
        pageSize,
        offset: (page - 1) * pageSize
    };
}
function uniqueProfileLibraries(libraries) {
    const byId = new Map();
    for (const library of libraries || []) {
        const id = library.id.trim();
        const title = library.title.trim();
        if (id && title && !byId.has(id)) {
            byId.set(id, title);
        }
    }
    return Array.from(byId, ([id, title]) => ({ id, title }));
}
function runInTransaction(db, task) {
    const savepoint = `note_tx_${randomUUID().replace(/-/g, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
        const result = task();
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
    }
    catch (e) {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        throw e;
    }
}
function getNoteSelectSql(whereSql) {
    return `
		SELECT
			sn.id,
			sn.watchlistId,
			w.stock_code,
			w.stock_name,
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
function resolveWatchlistStock(db, userId, args) {
    if (args.watchlistId) {
        return db.prepare(`
			SELECT id, stock_code, stock_name, exchange, market
			FROM watchlist
			WHERE id = ? AND userId = ? AND isDeleted = 0
		`).get(args.watchlistId.trim(), userId) || null;
    }
    if (args.stock_code && args.exchange) {
        return db.prepare(`
			SELECT id, stock_code, stock_name, exchange, market
			FROM watchlist
			WHERE userId = ? AND stock_code = ? AND exchange = ? AND isDeleted = 0
		`).get(userId, args.stock_code.trim(), args.exchange) || null;
    }
    return null;
}
function attachProfileLibraries(db, userId, rows) {
    if (rows.length === 0)
        return [];
    const noteIds = rows.map(row => row.id);
    const libraryRows = db.prepare(`
		SELECT npl.noteId, npl.profileLibraryId AS id, npl.title
		FROM stock_note_profile_libraries npl
		WHERE npl.userId = ? AND npl.noteId IN (${noteIds.map(() => "?").join(",")})
		ORDER BY npl.noteId, npl.createdAt ASC
	`).all(userId, ...noteIds);
    const librariesByNoteId = new Map();
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
function successWithPagination(data, page, pageSize, total) {
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
export const noteTools = {
    add_stock_note: {
        name: "add_stock_note",
        description: "新增股票笔记，笔记内容 200 字以内，可关联资料库列表；profileLibraryIds 格式为 { id, title }",
        parameters: AddStockNoteParamsSchema,
        registerTool: false,
        execute: async (args, ctx) => {
            try {
                const db = getDB();
                const uId = String(ctx.userId);
                const id = randomUUID();
                const stock = resolveWatchlistStock(db, uId, args);
                if (!stock) {
                    return JSON.stringify({ success: false, error: "股票不存在或未在自选列表中" });
                }
                const profileLibraries = uniqueProfileLibraries(args.profileLibraryIds);
                runInTransaction(db, () => {
                    db.prepare(`
						INSERT INTO stock_notes (id, userId, watchlistId, note)
						VALUES (?, ?, ?, ?)
					`).run(id, uId, stock.id, args.note);
                    const insertRelation = db.prepare(`
						INSERT INTO stock_note_profile_libraries (id, noteId, userId, profileLibraryId, title)
						VALUES (?, ?, ?, ?, ?)
					`);
                    profileLibraries.forEach((profileLibrary) => {
                        insertRelation.run(randomUUID(), id, uId, profileLibrary.id, profileLibrary.title);
                    });
                });
                const row = db.prepare(getNoteSelectSql("sn.id = ? AND sn.userId = ?")).get(id, uId);
                return JSON.stringify({ success: true, data: attachProfileLibraries(db, uId, [row])[0] });
            }
            catch (e) {
                return JSON.stringify({ success: false, error: e.message });
            }
        }
    },
    delete_stock_note: {
        name: "delete_stock_note",
        description: "删除股票笔记，并清理笔记关联资料库记录",
        parameters: DeleteStockNoteParamsSchema,
        registerTool: false,
        execute: async (args, ctx) => {
            try {
                const db = getDB();
                const uId = String(ctx.userId);
                const id = args.id.trim();
                const info = runInTransaction(db, () => {
                    db.prepare("DELETE FROM stock_note_profile_libraries WHERE noteId = ? AND userId = ?").run(id, uId);
                    return db.prepare("DELETE FROM stock_notes WHERE id = ? AND userId = ?").run(id, uId);
                });
                return JSON.stringify({ success: info.changes > 0 });
            }
            catch (e) {
                return JSON.stringify({ success: false, error: e.message });
            }
        }
    },
    update_stock_note: {
        name: "update_stock_note",
        description: "修改股票笔记；传入 profileLibraryIds 时会覆盖原有关联资料库列表；profileLibraryIds 格式为 { id, title }",
        parameters: UpdateStockNoteParamsSchema,
        registerTool: false,
        execute: async (args, ctx) => {
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
                const stock = (args.watchlistId || args.stock_code || args.exchange)
                    ? resolveWatchlistStock(db, uId, args)
                    : null;
                if ((args.watchlistId || args.stock_code || args.exchange) && !stock) {
                    return JSON.stringify({ success: false, error: "股票不存在或未在自选列表中" });
                }
                const profileLibraries = args.profileLibraryIds === undefined ? undefined : uniqueProfileLibraries(args.profileLibraryIds);
                runInTransaction(db, () => {
                    const updates = ["updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')"];
                    const updateParams = [];
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
                    if (profileLibraries) {
                        db.prepare(`
							DELETE FROM stock_note_profile_libraries
							WHERE userId = ? AND noteId = ?
						`).run(uId, id);
                        const insertRelation = db.prepare(`
							INSERT INTO stock_note_profile_libraries (id, noteId, userId, profileLibraryId, title)
							VALUES (?, ?, ?, ?, ?)
						`);
                        profileLibraries.forEach((profileLibrary) => {
                            insertRelation.run(randomUUID(), id, uId, profileLibrary.id, profileLibrary.title);
                        });
                    }
                });
                const row = db.prepare(getNoteSelectSql("sn.id = ? AND sn.userId = ?")).get(id, uId);
                return JSON.stringify({ success: true, data: attachProfileLibraries(db, uId, [row])[0] });
            }
            catch (e) {
                return JSON.stringify({ success: false, error: e.message });
            }
        }
    },
    get_stock_note_by_id: {
        name: "get_stock_note_by_id",
        description: "根据 ID 查询股票笔记详情",
        parameters: GetStockNoteByIdParamsSchema,
        registerTool: false,
        execute: async (args, ctx) => {
            try {
                const db = getDB();
                const uId = String(ctx.userId);
                const row = db.prepare(getNoteSelectSql("sn.id = ? AND sn.userId = ?")).get(args.id.trim(), uId);
                return JSON.stringify({ success: true, data: row ? attachProfileLibraries(db, uId, [row])[0] : null });
            }
            catch (e) {
                return JSON.stringify({ success: false, error: e.message });
            }
        }
    },
    query_stock_notes: {
        name: "query_stock_notes",
        description: "分页查询股票笔记，支持按股票代码、交易所和关键词过滤",
        parameters: QueryStockNotesParamsSchema,
        registerTool: false,
        execute: async (args = {}, ctx) => {
            try {
                const db = getDB();
                const uId = String(ctx.userId);
                const { page, pageSize, offset } = normalizePagination(args);
                const conditions = ["sn.userId = ?", "w.isDeleted = 0"];
                const params = [uId];
                if (args.watchlistId) {
                    conditions.push("sn.watchlistId = ?");
                    params.push(args.watchlistId);
                }
                if (args.stock_code) {
                    conditions.push("w.stock_code = ?");
                    params.push(args.stock_code);
                }
                if (args.exchange) {
                    conditions.push("w.exchange = ?");
                    params.push(args.exchange);
                }
                const keyword = args.keyword?.trim();
                if (keyword) {
                    const pattern = `%${escapeLikePattern(keyword)}%`;
                    conditions.push("(w.stock_code LIKE ? ESCAPE '\\' OR w.stock_name LIKE ? ESCAPE '\\' OR sn.note LIKE ? ESCAPE '\\')");
                    params.push(pattern, pattern, pattern);
                }
                const whereSql = conditions.join(" AND ");
                const total = db.prepare(`
					SELECT COUNT(*) AS count
					FROM stock_notes sn
					JOIN watchlist w ON w.id = sn.watchlistId AND w.userId = sn.userId
					WHERE ${whereSql}
				`).get(...params).count;
                const rows = db.prepare(`${getNoteSelectSql(whereSql)}
					ORDER BY sn.updatedAt DESC, sn.createdAt DESC
					LIMIT ? OFFSET ?
				`).all(...params, pageSize, offset);
                return successWithPagination(attachProfileLibraries(db, uId, rows), page, pageSize, total);
            }
            catch (e) {
                return JSON.stringify({ success: false, error: e.message });
            }
        }
    }
};
//# sourceMappingURL=tools.js.map