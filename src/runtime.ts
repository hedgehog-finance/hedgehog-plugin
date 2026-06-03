import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import path from "path";
import * as os from "node:os";
import { logger } from "./core/logger.js";
import { ensureDailyMorningBriefingCron } from "./dailyMorningBriefingCron.js";
import { ensureRegisteredToolsAllowedInConfig } from "./openclawConfig.js";

let runtime: PluginRuntime | null = null;
let dbPath: string = "";
let backupDir: string = "";

async function ensureAgentToolAllowConfig(next: PluginRuntime): Promise<void> {
	try {
		if (typeof next.config.mutateConfigFile !== "function") return;
		await next.config.mutateConfigFile({
			afterWrite: { mode: "auto" },
			mutate(draft) {
				const migrated = ensureRegisteredToolsAllowedInConfig(draft);
				if (!migrated) return;
				Object.assign(draft, migrated.config);
			}
		});
	} catch (e) {
		logger.error({ err: e }, "Failed to ensure Hedgehog agent tool allow config");
	}
}

export function setHedgehogRuntime(next: PluginRuntime): void {
	runtime = next;

	try {
		const cfg = next.config.loadConfig();
		const agentList = (cfg.agents?.list || []) as { id: string, workspace?: string }[];
		const hedgehogAgent = agentList.find((a) => a.id === "hedgehog-finance");
		const workspaceDir = hedgehogAgent?.workspace ||
			cfg.agents?.defaults?.workspace ||
			path.join(os.homedir(), ".openclaw", "hedgehog-workspace");

		dbPath = path.join(workspaceDir, "data", "business.db");
		backupDir = path.join(workspaceDir, "backups");
	} catch (e) {
		logger.error({ err: e }, "Failed to resolve workspace");
	}

	void ensureAgentToolAllowConfig(next);
	void ensureDailyMorningBriefingCron(next);
}

export function getDbPath(): string {
	if (!dbPath) throw new Error("[hedgehog-app] dbPath not initialized");
	return dbPath;
}

export function getBackupDir(): string {
	if (!backupDir) throw new Error("[hedgehog-app] backupDir not initialized");
	return backupDir;
}

export function getHedgehogRuntime(): PluginRuntime {
	if (!runtime) throw new Error("[hedgehog-app] runtime not initialized");
	return runtime;
}
