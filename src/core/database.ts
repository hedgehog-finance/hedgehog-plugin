// src/db/sqlite.ts
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { getDbPath, getBackupDir } from "../runtime";
import { logger } from "./logger";

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
		logger.info({ trigger, backupFilePath }, "数据库已自动备份");
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
				logger.info({ fileName: path.basename(fileObj.path) }, "清理过期备份");
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
		logger.info({ nextBackupTime: nextBackupTime.toLocaleString() }, "已安排下一次定时备份");
	};
	scheduleNextBackup();
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

		// 1. 基础表结构
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
		`);

	}
	return _db;
}