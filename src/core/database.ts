// src/db/sqlite.ts
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { getDbPath, getBackupDir } from "../runtime";
import { logger } from "./logger";

let _db: any = null;
let _backupJobStarted = false; // 防止多次初始化导致定时器重复创建

const MAX_BACKUPS = 10;

/**
 * 核心备份函数：执行备份并清理过期文件
 * @param trigger 'startup' | 'cron' 用于日志区分
 */
function performBackup(trigger: 'startup' | 'cron' = 'cron') {
	const dbPath = getDbPath();
	const backupDir = getBackupDir();

	if (!existsSync(dbPath)) return;

	try {
		// --- A. 执行备份 ---
		// 生成类似 "business_backup_2026-04-15T10-11-12-123Z_startup.db"
		const safeTimestamp = new Date().toISOString().replace(/[:]/g, '-');
		const backupFilePath = path.join(backupDir, `business_backup_${safeTimestamp}_${trigger}.db`);

		copyFileSync(dbPath, backupFilePath);
		logger.info({ trigger, backupFilePath }, "数据库已自动备份");

		// --- B. 保留策略：清理旧备份 ---
		const files = readdirSync(backupDir);
		const backupFiles = files
			.filter((f: string) => f.startsWith("business_backup_") && f.endsWith(".db"))
			.map((f: string) => {
				const fullPath = path.join(backupDir, f);
				return { path: fullPath, time: statSync(fullPath).mtimeMs };
			});

		if (backupFiles.length > MAX_BACKUPS) {
			backupFiles.sort((a, b) => a.time - b.time); // 按时间升序排序（旧的在前）
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

/**
 * 启动定时热备任务 (每天凌晨 3 点执行)
 */
function startDailyBackupJob() {
	const scheduleNextBackup = () => {
		const now = new Date();
		const nextBackupTime = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() + 1, // 明天的日期
			3, // 凌晨 3 点
			0, 0, 0
		);
		const delayMs = nextBackupTime.getTime() - now.getTime();

		setTimeout(() => {
			performBackup('cron');
			scheduleNextBackup(); // 执行完后再次调度
		}, delayMs);

		logger.info({ nextBackupTime: nextBackupTime.toLocaleString() }, "已安排下一次定时备份");
	};

	scheduleNextBackup();
}

export function getDB() {
	if (!_db) {
		const dbPath = getDbPath();
		const backupDir = getBackupDir();

		// 1. 确保核心目录存在
		mkdirSync(path.dirname(dbPath), { recursive: true });
		mkdirSync(backupDir, { recursive: true });

		// 2. 启动时的双保险备份调度
		if (!_backupJobStarted) {
			performBackup('startup'); // 每次代码重启/上线时立即留一份快照
			startDailyBackupJob();    // 挂载每日自动热备
			_backupJobStarted = true;
		}

		// 3. 数据库连接与配置
		_db = new DatabaseSync(dbPath);
		_db.exec("PRAGMA journal_mode = WAL");
		_db.exec("PRAGMA synchronous = NORMAL");

		// 4. 表结构初始化 (强制使用带 Z 的 ISO8601 时区安全格式)
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

        CREATE INDEX IF NOT EXISTS idx_watchlist_main
            ON watchlist(userId, isDeleted, sortOrder DESC);

        CREATE TABLE IF NOT EXISTS watchlist_groups (
            id         TEXT PRIMARY KEY,
            userId     TEXT NOT NULL,
            name       TEXT NOT NULL,
            sortOrder  REAL DEFAULT 0,
            createdAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
            updatedAt  DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
        );
        CREATE INDEX IF NOT EXISTS idx_watchlist_groups_user ON watchlist_groups(userId);

        CREATE TABLE IF NOT EXISTS watchlist_group_items (
            id          TEXT PRIMARY KEY,
            watchlistId TEXT NOT NULL,
            groupId     TEXT NOT NULL,
            userId      TEXT NOT NULL,
            createdAt   DATETIME DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
            UNIQUE(watchlistId, groupId)
        );
        CREATE INDEX IF NOT EXISTS idx_watchlist_group_items_main ON watchlist_group_items(userId, groupId);
		`);

		// Migration 逻辑保持不变...
		const tableInfo = _db.prepare("PRAGMA table_info(watchlist)").all();
		const hasGroupId = tableInfo.some((col: any) => col.name === 'groupId');
		if (hasGroupId) {
			const users = _db.prepare("SELECT DISTINCT userId FROM watchlist").all();
			const { randomUUID } = require("node:crypto");

			for (const user of users) {
				const uId = user.userId;
				let allGroup = _db.prepare("SELECT id FROM watchlist_groups WHERE userId = ? AND name = '全部'").get(uId);
				if (!allGroup) {
					const gid = randomUUID();
					_db.prepare("INSERT INTO watchlist_groups (id, userId, name, sortOrder) VALUES (?, ?, '全部', 0)").run(gid, uId);
					allGroup = { id: gid };
				}

				const items = _db.prepare("SELECT id, groupId FROM watchlist WHERE userId = ? AND isDeleted = 0").all(uId);
				for (const item of items) {
					_db.prepare("INSERT OR IGNORE INTO watchlist_group_items (id, watchlistId, groupId, userId) VALUES (?, ?, ?, ?)").run(randomUUID(), item.id, allGroup.id, uId);
					if (item.groupId && item.groupId !== allGroup.id) {
						_db.prepare("INSERT OR IGNORE INTO watchlist_group_items (id, watchlistId, groupId, userId) VALUES (?, ?, ?, ?)").run(randomUUID(), item.id, item.groupId, uId);
					}
				}
			}
		}
	}
	return _db;
}