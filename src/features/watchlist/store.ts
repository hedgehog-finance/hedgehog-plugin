import { randomUUID } from "node:crypto";

export function getOrCreateDefaultGroup(db: any, userId: string) {
	const defaultGroup = db.prepare("SELECT id FROM watchlist_groups WHERE userId = ? AND name = '全部'").get(userId) as any;
	if (defaultGroup) {
		return defaultGroup.id;
	}
	const newGroupId = randomUUID();
	db.prepare("INSERT INTO watchlist_groups (id, userId, name, sortOrder) VALUES (?, ?, '全部', 0)").run(newGroupId, userId);
	return newGroupId;
}

export function ensureStockInGroup(db: any, watchlistId: string, groupId: string, userId: string) {
	db.prepare(`
		INSERT OR IGNORE INTO watchlist_group_items (id, watchlistId, groupId, userId)
		VALUES (?, ?, ?, ?)
	`).run(randomUUID(), watchlistId, groupId, userId);
}
