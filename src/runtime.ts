import type { PluginRuntime } from "openclaw/plugin-sdk/channel-plugin-common";
import path from "path";
import * as os from "node:os";

let runtime: PluginRuntime | null = null;
let dbPath: string = "";
let backupDir: string = "";

export function setCiweiAIRuntime(next: PluginRuntime): void {
	runtime = next;

	try {
		// 从配置里读取 ciwei-ai 的 workspace
		const cfg = next.config.loadConfig();
		const agentList = cfg.agents?.list || [];
		const ciweiAgent = agentList.find((a: any) => a.id === "ciwei-ai");
		const workspaceDir = ciweiAgent?.workspace ||
			cfg.agents?.defaults?.workspace ||
			path.join(os.homedir(), ".openclaw", "ciwei-ai");

		dbPath = path.join(workspaceDir, "data", "business.db");
		backupDir = path.join(workspaceDir, "backups");
		console.log("[ciwei-ai] workspace:", workspaceDir);
		console.log("[ciwei-ai] dbPath:", dbPath);
	} catch (e) {
		console.error("[ciwei-ai] Failed to resolve workspace:", e);
	}
}

export function getDbPath(): string {
	if (!dbPath) throw new Error("[Ciwei-AI] dbPath not initialized");
	return dbPath;
}

export function getBackupDir(): string {
	if (!backupDir) throw new Error("[Ciwei-AI] backupDir not initialized");
	return backupDir;
}

export function getCiweiAIRuntime(): PluginRuntime {
	if (!runtime) throw new Error("[Ciwei-AI] runtime not initialized");
	return runtime;
}
