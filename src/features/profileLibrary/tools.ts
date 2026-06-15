import { randomUUID } from "node:crypto";
import { getDB } from "../../core/database.js";
import {
	AddProfileLibraryParams,
	AddProfileLibraryParamsSchema,
	DeleteProfileLibraryParams,
	DeleteProfileLibraryParamsSchema,
	GetProfileLibraryByIdParams,
	GetProfileLibraryByIdParamsSchema,
	GetProfileLibrariesParams,
	GetProfileLibrariesParamsSchema,
	ProfileLibraryRow,
	QueryProfileLibrariesParams,
	QueryProfileLibrariesParamsSchema,
	RuntimeTool
} from "./schema.js";

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

function paginatedResponse(rows: ProfileLibraryRow[], page: number, pageSize: number, total: number) {
	return JSON.stringify({
		success: true,
		data: rows,
		pagination: {
			page,
			pageSize,
			total,
			totalPages: Math.ceil(total / pageSize)
		}
	});
}

async function getProfileLibraries(args: GetProfileLibrariesParams = {}, ctx: { userId: string }) {
	try {
		const db = getDB();
		const uId = String(ctx.userId);
		const { page, pageSize, offset } = normalizePagination(args);
		const total = (db.prepare(`
			SELECT COUNT(*) AS count
			FROM profile_libraries
			WHERE userId = ?
		`).get(uId) as { count: number }).count;
		const rows = db.prepare(`
			SELECT id, title
			FROM profile_libraries
			WHERE userId = ?
			ORDER BY updatedAt DESC, createdAt DESC
			LIMIT ? OFFSET ?
		`).all(uId, pageSize, offset) as ProfileLibraryRow[];

		return paginatedResponse(rows, page, pageSize, total);
	} catch (e: any) {
		return JSON.stringify({ success: false, error: e.message });
	}
}

async function queryProfileLibraries(args: QueryProfileLibrariesParams = {}, ctx: { userId: string }) {
	try {
		const db = getDB();
		const uId = String(ctx.userId);
		const keyword = args.keyword?.trim();
		const { page, pageSize, offset } = normalizePagination(args);

		if (keyword) {
			const pattern = `%${escapeLikePattern(keyword)}%`;
			const total = (db.prepare(`
				SELECT COUNT(*) AS count
				FROM profile_libraries
				WHERE userId = ?
				  AND (title LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')
			`).get(uId, pattern, pattern) as { count: number }).count;
			const rows = db.prepare(`
				SELECT id, title
				FROM profile_libraries
				WHERE userId = ?
				  AND (title LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')
				ORDER BY updatedAt DESC, createdAt DESC
				LIMIT ? OFFSET ?
			`).all(uId, pattern, pattern, pageSize, offset) as ProfileLibraryRow[];
			return paginatedResponse(rows, page, pageSize, total);
		}

		return getProfileLibraries(args, ctx);
	} catch (e: any) {
		return JSON.stringify({ success: false, error: e.message });
	}
}

export const profileLibraryTools: Record<string, RuntimeTool> = {
	add_profile_library: {
		name: "add_profile_library",
		description: "新增个人资料库",
		parameters: AddProfileLibraryParamsSchema,
		registerTool: false,
		execute: async (args: AddProfileLibraryParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const id = args.id?.trim() || randomUUID();
				const title = args.title.trim();

				db.prepare(`
					INSERT INTO profile_libraries (id, userId, title)
					VALUES (?, ?, ?)
					ON CONFLICT(id, userId) DO UPDATE SET
						title = excluded.title,
						updatedAt = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')
				`).run(id, uId, title);

				return JSON.stringify({ success: true, data: { id, title } });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	delete_profile_library: {
		name: "delete_profile_library",
		description: "删除个人资料库",
		parameters: DeleteProfileLibraryParamsSchema,
		registerTool: false,
		execute: async (args: DeleteProfileLibraryParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const info = db.prepare(`
					DELETE FROM profile_libraries
					WHERE id = ? AND userId = ?
				`).run(args.id.trim(), uId);

				return JSON.stringify({ success: info.changes > 0 });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	get_profile_library_by_id: {
		name: "get_profile_library_by_id",
		description: "根据 ID 查询个人资料库",
		parameters: GetProfileLibraryByIdParamsSchema,
		registerTool: false,
		execute: async (args: GetProfileLibraryByIdParams, ctx: { userId: string }) => {
			try {
				const db = getDB();
				const uId = String(ctx.userId);
				const row = db.prepare(`
					SELECT id, title
					FROM profile_libraries
					WHERE id = ? AND userId = ?
				`).get(args.id.trim(), uId) as ProfileLibraryRow | undefined;

				return JSON.stringify({ success: true, data: row ?? null });
			} catch (e: any) {
				return JSON.stringify({ success: false, error: e.message });
			}
		}
	},

	query_profile_libraries: {
		name: "query_profile_libraries",
		description: "分页查询个人资料库，支持按标题或 ID 模糊查询",
		parameters: QueryProfileLibrariesParamsSchema,
		registerTool: false,
		execute: queryProfileLibraries
	},

	get_profile_libraries: {
		name: "get_profile_libraries",
		description: "分页获取个人资料库列表",
		parameters: GetProfileLibrariesParamsSchema,
		registerTool: false,
		execute: getProfileLibraries
	}
};
