// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { getDbPath, getBackupDir } from "../runtime.js";
import { logger } from "./logger.js";
let _db = null;
let _backupJobStarted = false;
const MAX_BACKUPS = 10;
function performBackup(trigger = 'cron') {
    const dbPath = getDbPath();
    const backupDir = getBackupDir();
    if (!existsSync(dbPath))
        return;
    try {
        const safeTimestamp = new Date().toISOString().replace(/[:]/g, '-');
        const backupFilePath = path.join(backupDir, `business_backup_${safeTimestamp}_${trigger}.db`);
        copyFileSync(dbPath, backupFilePath);
        const files = readdirSync(backupDir);
        const backupFiles = files
            .filter((f) => f.startsWith("business_backup_") && f.endsWith(".db"))
            .map((f) => {
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
    }
    catch (e) {
        logger.error({ err: e, trigger }, "数据库备份或清理失败");
    }
}
function startDailyBackupJob() {
    const scheduleNextBackup = () => {
        const now = new Date();
        const nextBackupTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 3, 0, 0, 0);
        const delayMs = nextBackupTime.getTime() - now.getTime();
        setTimeout(() => {
            performBackup('cron');
            scheduleNextBackup();
        }, delayMs);
    };
    scheduleNextBackup();
}
function normalizeMetadataStockCode(stock_code, exchange) {
    const code = String(stock_code || "").trim().toUpperCase();
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
function runStockColumnNameMigrations(db) {
    const legacyCodeColumn = "stock" + "Code";
    const legacyNameColumn = "stock" + "Name";
    const tables = ["watchlist", "global_stock_metadata", "stock_classification_cache", "stock_ai_analysis"];
    for (const table of tables) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all();
        const columnNames = new Set(columns.map(column => column.name));
        if (columnNames.has(legacyCodeColumn) && !columnNames.has("stock_code")) {
            db.prepare(`ALTER TABLE ${table} RENAME COLUMN ${legacyCodeColumn} TO stock_code`).run();
        }
        if (columnNames.has(legacyNameColumn) && !columnNames.has("stock_name")) {
            db.prepare(`ALTER TABLE ${table} RENAME COLUMN ${legacyNameColumn} TO stock_name`).run();
        }
    }
}
function runWatchlistDedupMigrations(db) {
    db.exec("BEGIN TRANSACTION");
    try {
        const metadataRows = db.prepare(`
			SELECT stock_code, exchange FROM stock_classification_cache
		`).all();
        const metadataDeleteStmt = db.prepare(`
			DELETE FROM stock_classification_cache WHERE stock_code = ? AND exchange = ?
		`);
        const metadataUpdateStmt = db.prepare(`
			UPDATE stock_classification_cache SET stock_code = ? WHERE stock_code = ? AND exchange = ?
		`);
        const metadataExistsStmt = db.prepare(`
			SELECT 1 FROM stock_classification_cache WHERE stock_code = ? AND exchange = ?
		`);
        for (const row of metadataRows) {
            const normalizedCode = normalizeMetadataStockCode(row.stock_code, row.exchange);
            if (!normalizedCode || normalizedCode === row.stock_code)
                continue;
            const existing = metadataExistsStmt.get(normalizedCode, row.exchange);
            if (existing) {
                metadataDeleteStmt.run(row.stock_code, row.exchange);
            }
            else {
                metadataUpdateStmt.run(normalizedCode, row.stock_code, row.exchange);
            }
        }
        const duplicateCategories = db.prepare(`
			SELECT userId, name, type, MIN(id) AS keepId, GROUP_CONCAT(id) AS ids
			FROM industry_theme_categories
			GROUP BY userId, name, type
			HAVING COUNT(*) > 1
		`).all();
        for (const dup of duplicateCategories) {
            const table = dup.type === 'industry' ? 'watchlist_industry_items' : 'watchlist_theme_items';
            const ids = dup.ids.split(",").filter(id => id && id !== dup.keepId);
            for (const oldId of ids) {
                db.prepare(`UPDATE ${table} SET categoryId = ? WHERE userId = ? AND categoryId = ?`).run(dup.keepId, dup.userId, oldId);
                db.prepare("DELETE FROM industry_theme_categories WHERE id = ?").run(oldId);
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
    }
    catch (e) {
        if (db.inTransaction)
            db.exec("ROLLBACK");
        throw e;
    }
    db.exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_theme_categories_user_name_type
			ON industry_theme_categories(userId, name, type);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_industry_items_watchlist_category
			ON watchlist_industry_items(watchlistId, categoryId);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_theme_items_watchlist_category
			ON watchlist_theme_items(watchlistId, categoryId);
	`);
}
function runClassificationCacheMigrations(db) {
    const oldColumns = db.prepare("PRAGMA table_info(global_stock_metadata)").all();
    if (oldColumns.length === 0)
        return;
    const oldColumnNames = new Set(oldColumns.map(column => column.name));
    const industryColumn = oldColumnNames.has("industry_classification") ? "industry_classification" : "industryJson";
    const themeColumn = oldColumnNames.has("theme_classification") ? "theme_classification" : oldColumnNames.has("theme") ? "theme" : "themeJson";
    const updatedColumn = oldColumnNames.has("last_updated") ? "last_updated" : "lastUpdated";
    if (!oldColumnNames.has(industryColumn) || !oldColumnNames.has(themeColumn))
        return;
    db.exec("BEGIN");
    try {
        db.exec(`
			INSERT OR REPLACE INTO stock_classification_cache (
				stock_code,
				exchange,
				stock_name,
				industry_classification,
				theme_classification,
				last_updated
			)
			SELECT
				stock_code,
				exchange,
				stock_name,
				${industryColumn},
				${themeColumn},
				${updatedColumn}
			FROM global_stock_metadata;

			DROP TABLE global_stock_metadata;
		`);
        db.exec("COMMIT");
    }
    catch (e) {
        if (db.inTransaction)
            db.exec("ROLLBACK");
        throw e;
    }
}
function runClassificationCacheSchemaMigrations(db) {
    const columns = db.prepare("PRAGMA table_info(stock_classification_cache)").all();
    if (columns.length === 0)
        return;
    const columnNames = new Set(columns.map(column => column.name));
    if (columnNames.has("theme") && !columnNames.has("theme_classification")) {
        db.prepare("ALTER TABLE stock_classification_cache RENAME COLUMN theme TO theme_classification").run();
        columnNames.delete("theme");
        columnNames.add("theme_classification");
    }
    if (columnNames.has("lastUpdated") && !columnNames.has("last_updated")) {
        db.prepare("ALTER TABLE stock_classification_cache RENAME COLUMN lastUpdated TO last_updated").run();
    }
}
function runIndustryThemeCategoryMigrations(db) {
    const oldColumns = db.prepare("PRAGMA table_info(watchlist_categories)").all();
    if (oldColumns.length === 0)
        return;
    db.exec("BEGIN");
    try {
        db.exec(`
			INSERT OR IGNORE INTO industry_theme_categories (
				id,
				remoteId,
				userId,
				name,
				type,
				weight,
				sortOrder,
				createdAt,
				updatedAt
			)
			SELECT
				id,
				remoteId,
				userId,
				name,
				type,
				weight,
				sortOrder,
				createdAt,
				updatedAt
			FROM watchlist_categories;

			DROP TABLE watchlist_categories;
		`);
        db.exec("COMMIT");
    }
    catch (e) {
        if (db.inTransaction)
            db.exec("ROLLBACK");
        throw e;
    }
}
function runStockNotesMigrations(db) {
    const columns = db.prepare("PRAGMA table_info(stock_notes)").all();
    if (columns.length > 0 && !columns.some(column => column.name === "watchlistId")) {
        db.prepare("ALTER TABLE stock_notes ADD COLUMN watchlistId TEXT").run();
    }
    const relationColumns = db.prepare("PRAGMA table_info(stock_note_profile_libraries)").all();
    if (relationColumns.length > 0 && !relationColumns.some(column => column.name === "title")) {
        db.prepare("ALTER TABLE stock_note_profile_libraries ADD COLUMN title TEXT NOT NULL DEFAULT ''").run();
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_stock_notes_user_stock ON stock_notes(userId, watchlistId, updatedAt DESC)");
}
function runProfileLibrariesSchemaMigrations(db) {
    const columns = db.prepare("PRAGMA table_info(profile_libraries)").all();
    if (columns.length === 0)
        return;
    const columnNames = new Set(columns.map(column => column.name));
    if (!columnNames.has("knowType")) {
        db.prepare("ALTER TABLE profile_libraries ADD COLUMN knowType TEXT").run();
    }
    if (!columnNames.has("recordDate")) {
        db.prepare("ALTER TABLE profile_libraries ADD COLUMN recordDate DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))").run();
    }
    if (!columnNames.has("content")) {
        db.prepare("ALTER TABLE profile_libraries ADD COLUMN content TEXT").run();
    }
    if (!columnNames.has("vectorValue")) {
        db.prepare("ALTER TABLE profile_libraries ADD COLUMN vectorValue BLOB").run();
    }
    if (!columnNames.has("source")) {
        db.prepare("ALTER TABLE profile_libraries ADD COLUMN source TEXT").run();
    }
}
export function getDB() {
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
        runStockColumnNameMigrations(_db);
        _db.exec(`
        CREATE TABLE IF NOT EXISTS watchlist (
			id         TEXT PRIMARY KEY,
			userId     TEXT NOT NULL,
			stock_code  TEXT NOT NULL,
			exchange   TEXT NOT NULL,
			market     TEXT NOT NULL,
			stock_name  TEXT NOT NULL,
			sortOrder  REAL DEFAULT 0,
			isDeleted  INTEGER DEFAULT 0 CHECK (isDeleted IN (0, 1)),
            createdAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
            updatedAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
            UNIQUE(userId, stock_code, exchange)
		);

		CREATE TABLE IF NOT EXISTS stock_classification_cache (
			stock_code               TEXT NOT NULL,
			exchange                 TEXT NOT NULL,
			stock_name               TEXT NOT NULL,
			industry_classification  TEXT,
			theme_classification     TEXT,
			last_updated             DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			PRIMARY KEY(stock_code, exchange)
		);

        CREATE INDEX IF NOT EXISTS idx_watchlist_main ON watchlist(userId, isDeleted, sortOrder ASC);

		CREATE TABLE IF NOT EXISTS stock_basic (
			stock_code    TEXT PRIMARY KEY,
			symbol        TEXT NOT NULL,
			name          TEXT NOT NULL,
			fullname      TEXT,
			enname        TEXT,
			cnspell       TEXT,
			exchange      TEXT NOT NULL,
			market        TEXT,
			industry      TEXT,
			area          TEXT,
			curr_type     TEXT,
			list_date     TEXT,
			is_hs         TEXT,
			act_name      TEXT,
			act_ent_type  TEXT,
			createdAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			updatedAt     DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
		);
		CREATE INDEX IF NOT EXISTS idx_stock_basic_exchange_symbol ON stock_basic(exchange, symbol);
		CREATE INDEX IF NOT EXISTS idx_stock_basic_name ON stock_basic(name);

		CREATE TABLE IF NOT EXISTS industry_theme_categories (
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
			knowType      TEXT,
			title         TEXT NOT NULL,
			recordDate    DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			content       TEXT,
			vectorValue   BLOB,
			source        TEXT,
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

		CREATE TABLE IF NOT EXISTS works (
			id              TEXT PRIMARY KEY,
			name            TEXT NOT NULL,
			description     TEXT,
			status          TEXT NOT NULL DEFAULT 'pending',
			priority        INTEGER DEFAULT 0,
			orchestrator_type TEXT NOT NULL DEFAULT 'hard',
			workflow_def    TEXT,
			agent_type      TEXT DEFAULT 'hogagent',
			result_task_id  TEXT,
			created_by      TEXT DEFAULT 'user',
			started_at      DATETIME,
			completed_at    DATETIME,
			created_at      DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			updated_at      DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
		);

		CREATE TABLE IF NOT EXISTS tasks (
			id              TEXT PRIMARY KEY,
			work_id         TEXT NOT NULL REFERENCES works(id),
			name            TEXT NOT NULL,
			mode            TEXT DEFAULT 'standard',
			status          TEXT NOT NULL DEFAULT 'pending',
			depends_on      TEXT DEFAULT '[]',
			agent_session_id TEXT,
			prompt          TEXT,
			required_tools_or_skills TEXT DEFAULT '[]',
			content         TEXT,
			summary         TEXT,
			delivery_files  TEXT DEFAULT '[]',
			validation      TEXT,
			validation_result TEXT DEFAULT 'pending',
			started_at      DATETIME,
			completed_at    DATETIME,
			created_at      DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			updated_at      DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
		);

		CREATE TABLE IF NOT EXISTS scheduled_jobs (
			id              TEXT PRIMARY KEY,
			name            TEXT NOT NULL,
			description     TEXT,
			schedule_type   TEXT NOT NULL,
			schedule_config TEXT NOT NULL,
			work_template   TEXT NOT NULL,
			enabled         INTEGER DEFAULT 1,
			max_retries     INTEGER DEFAULT 0,
			retry_count     INTEGER DEFAULT 0,
			last_run_at     DATETIME,
			last_run_status TEXT,
			next_run_at     DATETIME,
			run_count       INTEGER DEFAULT 0,
			created_at      DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			updated_at      DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
		);

		CREATE TABLE IF NOT EXISTS agent_sessions (
			id              TEXT NOT NULL,
			session_name    TEXT,
			biz_type        TEXT NOT NULL DEFAULT 'session',
			agent_type      TEXT DEFAULT 'hogagent',
			mode            TEXT DEFAULT 'quick',
			status          TEXT DEFAULT 'active',
			reference       TEXT,
			work_id         TEXT,
			task_id         TEXT,
			content         TEXT,
			summary         TEXT,
			delivery_files  TEXT DEFAULT '[]',
			token_usage     TEXT DEFAULT '{}',
			created_at      DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			updated_at      DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			PRIMARY KEY(id)
		);
		CREATE INDEX IF NOT EXISTS idx_agent_sessions_biz ON agent_sessions(biz_type, created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_agent_sessions_work ON agent_sessions(work_id);
		CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id);

		CREATE TABLE IF NOT EXISTS skill_versions (
			skillName  TEXT PRIMARY KEY,
			version    TEXT NOT NULL,
			createdAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
			updatedAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
		);


		`);
        runClassificationCacheSchemaMigrations(_db);
        runClassificationCacheMigrations(_db);
        runClassificationCacheSchemaMigrations(_db);
        runIndustryThemeCategoryMigrations(_db);
        runWatchlistDedupMigrations(_db);
        runStockNotesMigrations(_db);
        runProfileLibrariesSchemaMigrations(_db);
    }
    return _db;
}
//# sourceMappingURL=database.js.map