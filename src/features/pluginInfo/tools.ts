import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getDB } from "../../core/database.js";
import { getWorkspaceDir } from "../../runtime.js";
import {
	BuildUpdateSkillVersionsMessageParams,
	BuildUpdateSkillVersionsMessageParamsSchema,
	GetPluginVersionParamsSchema,
	GetSkillVersionsParamsSchema,
	RuntimeTool,
	UpdateSkillVersionsParams,
	UpdateSkillVersionsParamsSchema
} from "./schema.js";

const UPDATE_SKILL_VERSIONS_TOOL_NAME = "update_hedgehog_skill_versions";
const HEDGEHOG_INIT_SKILL_NAME = "hedgehog-init";

let cachedPluginVersion: string | null = null;

type SkillVersionRow = { skillName: string; version: string; createdAt: string; updatedAt: string };
type SkillVersionUpdate = { name: string; version: string };

function findPackageJsonPath(startDir: string): string | null {
	let currentDir = startDir;

	while (true) {
		const candidate = path.join(currentDir, "package.json");
		if (fs.existsSync(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function getPluginVersion(): string {
	if (cachedPluginVersion) return cachedPluginVersion;

	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	const packageJsonPath = findPackageJsonPath(moduleDir);
	if (!packageJsonPath) {
		throw new Error("无法找到插件 package.json");
	}

	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { version?: unknown };
	if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
		throw new Error("插件 package.json 缺少有效版本号");
	}

	cachedPluginVersion = packageJson.version.trim();
	return cachedPluginVersion;
}

function readWorkspaceSkillVersions(): SkillVersionUpdate[] {
	const versionJsonPath = path.join(getWorkspaceDir(), "version.json");
	if (!fs.existsSync(versionJsonPath)) return [];

	const parsed = JSON.parse(fs.readFileSync(versionJsonPath, "utf-8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

	const updates: SkillVersionUpdate[] = [];
	for (const [name, version] of Object.entries(parsed)) {
		if (typeof version !== "string") continue;
		const trimmedName = name.trim();
		const trimmedVersion = version.trim();
		if (trimmedName && trimmedVersion) updates.push({ name: trimmedName, version: trimmedVersion });
	}
	return updates;
}

function persistSkillVersions(updates: SkillVersionUpdate[]) {
	const db = getDB();
	const stmt = db.prepare(`
		INSERT INTO skill_versions (skillName, version, updatedAt)
		VALUES (?, ?, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
		ON CONFLICT(skillName) DO UPDATE SET
			version = excluded.version,
			updatedAt = excluded.updatedAt
	`);

	db.exec("BEGIN");
	try {
		for (const update of updates) {
			stmt.run(update.name, update.version);
		}
		db.exec("COMMIT");
	} catch (e) {
		if (db.inTransaction) db.exec("ROLLBACK");
		throw e;
	}
}

function listSkillVersionRows(): SkillVersionRow[] {
	return getDB().prepare(`
		SELECT skillName, version, createdAt, updatedAt
		FROM skill_versions
		ORDER BY skillName ASC
	`).all() as SkillVersionRow[];
}

function getSkillVersions() {
	let rows = listSkillVersionRows();
	if (rows.length === 0) {
		const workspaceVersions = readWorkspaceSkillVersions();
		if (workspaceVersions.length > 0) {
			persistSkillVersions(workspaceVersions);
			rows = listSkillVersionRows();
		}
	}

	const versions: Record<string, string> = {};
	const skills = rows.map(row => {
		versions[row.skillName] = row.version;
		return {
			skillName: row.skillName,
			version: row.version,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		};
	});

	return {
		skills,
		versions
	};
}

function normalizeSkillVersionUpdates(params: UpdateSkillVersionsParams) {
	const updates = new Map<string, string>();

	if (params.versions) {
		for (const [name, version] of Object.entries(params.versions)) {
			const trimmedName = name.trim();
			const trimmedVersion = version.trim();
			if (trimmedName && trimmedVersion) updates.set(trimmedName, trimmedVersion);
		}
	}

	if (params.skills) {
		for (const skill of params.skills) {
			const trimmedName = skill.name.trim();
			const trimmedVersion = skill.version.trim();
			if (trimmedName && trimmedVersion) updates.set(trimmedName, trimmedVersion);
		}
	}

	return Array.from(updates.entries()).map(([name, version]) => ({ name, version }));
}

function updateSkillVersions(params: UpdateSkillVersionsParams) {
	const updates = normalizeSkillVersionUpdates(params);

	// 在操作数据库前，确保数据库已初始化
	// getDB() 会自动创建数据库文件和表结构
	persistSkillVersions(updates);

	return {
		updated: updates,
		...getSkillVersions()
	};
}

function buildUpdateSkillVersionsMessage(params: BuildUpdateSkillVersionsMessageParams): string {
	const updates = normalizeSkillVersionUpdates(params);
	const toolParams = {
		skills: updates
	};
	const includesHedgehogInit = updates.some(update => update.name === HEDGEHOG_INIT_SKILL_NAME);

	if (includesHedgehogInit) {
		return JSON.stringify({
			cw_system_prompt: [
				"必须使用 hedgehog-init skill 更新 hedgehog-workspace 的系统提示词到最新版本。",
				`成功后必须调用 ${UPDATE_SKILL_VERSIONS_TOOL_NAME} ，参数为 ${JSON.stringify(toolParams)}。`,
				"如果系统提示词更新失败，禁止调用 update_hedgehog_skill_versions，必须直接说明失败原因。"
			].join("\n"),
			cw_content: "Skill升级了，帮我更新`hedgehog-workspace`系统提示词到最新版本。",
			cw_output: "系统提示词更新成功后，返回简短结果。"
		});
	}

	return JSON.stringify({
		cw_system_prompt: [
			"必须先通过 hedgehog-init skill 更新 hedgehog-workspace 中的 hedgehog skills。",
			`更新成功后必须调用 ${UPDATE_SKILL_VERSIONS_TOOL_NAME} ，参数为 ${JSON.stringify(toolParams)}。`,
			"如果 hedgehog skills 更新失败，禁止调用 update_hedgehog_skill_versions，必须直接说明失败原因。"
		].join("\n"),
		cw_content: "帮我更新`hedgehog-workspace`的hedgehog skills",
		cw_output: "hedgehog skills 更新成功后，并返回简短结果。"
	});
}

export const pluginInfoTools: Record<string, RuntimeTool> = {
	get_plugin_version: {
		name: "get_plugin_version",
		description: "获取当前 Hedgehog 插件版本号",
		parameters: GetPluginVersionParamsSchema,
		registerTool: false,
		async execute(params: unknown) {
			GetPluginVersionParamsSchema.parse(params);
			return JSON.stringify({
				success: true,
				version: getPluginVersion()
			});
		}
	},
	get_skill_versions: {
		name: "get_skill_versions",
		description: "获取数据库中记录的所有 skill 版本号",
		parameters: GetSkillVersionsParamsSchema,
		registerTool: false,
		async execute(params: unknown) {
			GetSkillVersionsParamsSchema.parse(params);
			return JSON.stringify({
				success: true,
				...getSkillVersions()
			});
		}
	},
	update_hedgehog_skill_versions: {
		name: "update_hedgehog_skill_versions",
		description: "更新数据库中记录的 skill 版本号",
		parameters: UpdateSkillVersionsParamsSchema,
		registerTool: false,
		agentToolTarget: "main",
		async execute(params: unknown) {
			const parsed = UpdateSkillVersionsParamsSchema.parse(params);
			return JSON.stringify({
				success: true,
				...updateSkillVersions(parsed)
			});
		}
	},
	build_update_skill_versions_message: {
		name: "build_update_skill_versions_message",
		description: "构建用于主动 RPC 发起 Agent 更新数据库 skill 版本号任务的标准消息。该方法只返回提示词消息体，不直接更新数据库。",
		parameters: BuildUpdateSkillVersionsMessageParamsSchema,
		registerTool: false,
		async execute(params: unknown) {
			const parsed = BuildUpdateSkillVersionsMessageParamsSchema.parse(params);
			const message = buildUpdateSkillVersionsMessage(parsed);
			return JSON.stringify({
				success: true,
				data: {
					message,
					payload: JSON.parse(message),
					tool: UPDATE_SKILL_VERSIONS_TOOL_NAME,
					updateParams: {
						skills: normalizeSkillVersionUpdates(parsed)
					}
				}
			});
		}
	}
};
