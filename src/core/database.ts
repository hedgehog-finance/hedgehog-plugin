// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { getDbPath, getBackupDir } from "../runtime.js";
import { logger } from "./logger.js";

let _db: any = null;
let _backupJobStarted = false;

const MAX_BACKUPS = 10;

function performBackup(trigger: 'startup' | 'cron' = 'cron') {
	const dbPath = getDbPath();
	const backupDir = getBackupDir();
	if (!existsSync(dbPath)) return;
	try {
		const safeTimestamp = new Date().toISOString().replace(/[:]/g, '-');
		const backupFilePath = path.join(backupDir, `business_backup_${safeTimestamp}_${trigger}.db`);
		copyFileSync(dbPath, backupFilePath);
		const files = readdirSync(backupDir);
		const backupFiles = files
			.filter((f: string) => f.startsWith("business_backup_") && f.endsWith(".db"))
			.map((f: string) => {
				const fullPath = path.join(backupDir, f);
				return { path: fullPath, time: statSync(fullPath).mtimeMs };
			});
		if (backupFiles.length > MAX_BACKUPS) {
			backupFiles.sort((a, b) => a.time - b.time);
			const filesToDelete = backupFiles.slice(0, backupFiles.length - MAX_BACKUPS);
			for (const fileObj of filesToDelete) {
				unlinkSync(fileObj.path);
			}
		}
	} catch (e) {
		logger.error({ err: e, trigger }, "数据库备份或清理失败");
	}
}

function startDailyBackupJob() {
	const scheduleNextBackup = () => {
		const now = new Date();
		const nextBackupTime = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() + 1,
			3, 0, 0, 0
		);
		const delayMs = nextBackupTime.getTime() - now.getTime();
		setTimeout(() => {
			performBackup('cron');
			scheduleNextBackup();
		}, delayMs);
	};
	scheduleNextBackup();
}

function normalizeMetadataStockCode(stockCode: string, exchange: string): string {
	const code = String(stockCode || "").trim().toUpperCase();
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

function runWatchlistDedupMigrations(db: DatabaseSync) {
	db.exec("BEGIN TRANSACTION");
	try {
		const metadataRows = db.prepare(`
			SELECT stockCode, exchange FROM global_stock_metadata
		`).all() as { stockCode: string; exchange: string }[];
		const metadataDeleteStmt = db.prepare(`
			DELETE FROM global_stock_metadata WHERE stockCode = ? AND exchange = ?
		`);
		const metadataUpdateStmt = db.prepare(`
			UPDATE global_stock_metadata SET stockCode = ? WHERE stockCode = ? AND exchange = ?
		`);
		const metadataExistsStmt = db.prepare(`
			SELECT 1 FROM global_stock_metadata WHERE stockCode = ? AND exchange = ?
		`);
		for (const row of metadataRows) {
			const normalizedCode = normalizeMetadataStockCode(row.stockCode, row.exchange);
			if (!normalizedCode || normalizedCode === row.stockCode) continue;
			const existing = metadataExistsStmt.get(normalizedCode, row.exchange);
			if (existing) {
				metadataDeleteStmt.run(row.stockCode, row.exchange);
			} else {
				metadataUpdateStmt.run(normalizedCode, row.stockCode, row.exchange);
			}
		}

		const duplicateCategories = db.prepare(`
			SELECT userId, name, type, MIN(id) AS keepId, GROUP_CONCAT(id) AS ids
			FROM watchlist_categories
			GROUP BY userId, name, type
			HAVING COUNT(*) > 1
		`).all() as { userId: string; name: string; type: 'industry' | 'theme'; keepId: string; ids: string }[];
		for (const dup of duplicateCategories) {
			const table = dup.type === 'industry' ? 'watchlist_industry_items' : 'watchlist_theme_items';
			const ids = dup.ids.split(",").filter(id => id && id !== dup.keepId);
			for (const oldId of ids) {
				db.prepare(`UPDATE ${table} SET categoryId = ? WHERE userId = ? AND categoryId = ?`).run(dup.keepId, dup.userId, oldId);
				db.prepare("DELETE FROM watchlist_categories WHERE id = ?").run(oldId);
			}
		}

		db.exec(`
			DELETE FROM watchlist_industry_items
			WHERE rowid NOT IN (
				SELECT MIN(rowid) FROM watchlist_industry_items GROUP BY watchlistId, categoryId
			);

			DELETE FROM watchlist_theme_items
			WHERE rowid NOT IN (
				SELECT MIN(rowid) FROM watchlist_theme_items GROUP BY watchlistId, categoryId
			);
		`);

		db.exec("COMMIT");
	} catch (e) {
		if (db.inTransaction) db.exec("ROLLBACK");
		throw e;
	}

	db.exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_categories_user_name_type
			ON watchlist_categories(userId, name, type);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_industry_items_watchlist_category
			ON watchlist_industry_items(watchlistId, categoryId);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_theme_items_watchlist_category
			ON watchlist_theme_items(watchlistId, categoryId);
	`);
}

function runStockNotesMigrations(db: DatabaseSync) {
	const columns = db.prepare("PRAGMA table_info(stock_notes)").all() as { name: string }[];
	if (columns.length > 0 && !columns.some(column => column.name === "watchlistId")) {
		db.prepare("ALTER TABLE stock_notes ADD COLUMN watchlistId TEXT").run();
	}
	const relationColumns = db.prepare("PRAGMA table_info(stock_note_profile_libraries)").all() as { name: string }[];
	if (relationColumns.length > 0 && !relationColumns.some(column => column.name === "title")) {
		db.prepare("ALTER TABLE stock_note_profile_libraries ADD COLUMN title TEXT NOT NULL DEFAULT ''").run();
	}
	db.exec("CREATE INDEX IF NOT EXISTS idx_stock_notes_user_stock ON stock_notes(userId, watchlistId, updatedAt DESC)");
}

export function getDB(): DatabaseSync {
	if (!_db) {
		const dbPath = getDbPath();
		const backupDir = getBackupDir();
		mkdirSync(path.dirname(dbPath), { recursive: true });
		mkdirSync(backupDir, { recursive: true });

		if (!_backupJobStarted) {
			performBackup('startup');
			startDailyBackupJob();
			_backupJobStarted = true;
		}

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
            createdAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
            updatedAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
            UNIQUE(userId, stockCode, exchange)
		);

		CREATE TABLE IF NOT EXISTS global_stock_metadata (
			stockCode     TEXT NOT NULL,
			exchange      TEXT NOT NULL,
			stockName     TEXT NOT NULL,
			industryJson  TEXT,
			themeJson     TEXT,
			lastUpdated   DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			PRIMARY KEY(stockCode, exchange)
		);

        CREATE INDEX IF NOT EXISTS idx_watchlist_main ON watchlist(userId, isDeleted, sortOrder ASC);

		CREATE TABLE IF NOT EXISTS watchlist_categories (
			id            TEXT PRIMARY KEY,
			remoteId      TEXT,
			userId        TEXT NOT NULL,
			name          TEXT NOT NULL,
			type          TEXT NOT NULL CHECK (type IN ('industry', 'theme')),
			weight        REAL DEFAULT 0,
			sortOrder     REAL DEFAULT 0,
			createdAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			updatedAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			UNIQUE(userId, remoteId),
			UNIQUE(userId, name, type)
		);

		CREATE TABLE IF NOT EXISTS watchlist_industry_items (
			id            TEXT PRIMARY KEY,
			watchlistId   TEXT NOT NULL,
			userId        TEXT NOT NULL,
			categoryId    TEXT NOT NULL,
			weight        REAL DEFAULT 0,
			createdAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			UNIQUE(watchlistId, categoryId)
		);
		CREATE INDEX IF NOT EXISTS idx_watchlist_industry_user ON watchlist_industry_items(userId);

		CREATE TABLE IF NOT EXISTS watchlist_theme_items (
			id            TEXT PRIMARY KEY,
			watchlistId   TEXT NOT NULL,
			userId        TEXT NOT NULL,
			categoryId    TEXT NOT NULL,
			weight        REAL DEFAULT 0,
			createdAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			UNIQUE(watchlistId, categoryId)
		);
		CREATE INDEX IF NOT EXISTS idx_watchlist_theme_user ON watchlist_theme_items(userId);

		CREATE TABLE IF NOT EXISTS profile_libraries (
			id            TEXT NOT NULL,
			userId        TEXT NOT NULL,
			title         TEXT NOT NULL,
			createdAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			updatedAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			PRIMARY KEY(id, userId)
		);
		CREATE INDEX IF NOT EXISTS idx_profile_libraries_user_title ON profile_libraries(userId, title);

		CREATE TABLE IF NOT EXISTS stock_notes (
			id            TEXT NOT NULL,
			userId        TEXT NOT NULL,
			watchlistId   TEXT NOT NULL,
			note          TEXT NOT NULL CHECK (length(note) <= 200),
			createdAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			updatedAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			PRIMARY KEY(id, userId)
		);

		CREATE TABLE IF NOT EXISTS stock_note_profile_libraries (
			id                TEXT PRIMARY KEY,
			noteId            TEXT NOT NULL,
			userId            TEXT NOT NULL,
			profileLibraryId  TEXT NOT NULL,
			title             TEXT NOT NULL,
			createdAt         DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			UNIQUE(noteId, userId, profileLibraryId)
		);
		CREATE INDEX IF NOT EXISTS idx_stock_note_profile_libraries_user_note ON stock_note_profile_libraries(userId, noteId);
		`);

		runWatchlistDedupMigrations(_db);
		runStockNotesMigrations(_db);
	}
	return _db;
}
