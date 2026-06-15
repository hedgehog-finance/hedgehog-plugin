import path from "path";
import * as os from "node:os";
import { logger } from "./core/logger.js";
import { ensureRegisteredToolsAllowedInConfig } from "./openclawConfig.js";
let runtime = null;
let workspaceDir = "";
let dbPath = "";
let backupDir = "";
async function ensureAgentToolAllowConfig(next) {
    try {
        if (typeof next.config.mutateConfigFile !== "function")
            return;
        await next.config.mutateConfigFile({
            afterWrite: { mode: "auto" },
            mutate(draft) {
                const migrated = ensureRegisteredToolsAllowedInConfig(draft);
                if (!migrated)
                    return;
                Object.assign(draft, migrated.config);
            }
        });
    }
    catch (e) {
        logger.error({ err: e }, "Failed to ensure Hedgehog agent tool allow config");
    }
}
export function setHedgehogRuntime(next) {
    runtime = next;
    try {
        const cfg = next.config.loadConfig();
        const agentList = (cfg.agents?.list || []);
        const hedgehogAgent = agentList.find((a) => a.id === "hedgehog-finance");
        workspaceDir = hedgehogAgent?.workspace ||
            cfg.agents?.defaults?.workspace ||
            path.join(os.homedir(), ".openclaw", "hedgehog-workspace");
        dbPath = path.join(workspaceDir, "data", "business.db");
        backupDir = path.join(workspaceDir, "backups");
    }
    catch (e) {
        logger.error({ err: e }, "Failed to resolve workspace");
    }
    void ensureAgentToolAllowConfig(next);
}
export function getDbPath() {
    if (!dbPath)
        throw new Error("[hedgehog-app] dbPath not initialized");
    return dbPath;
}
export function getWorkspaceDir() {
    if (!workspaceDir)
        throw new Error("[hedgehog-app] workspaceDir not initialized");
    return workspaceDir;
}
export function getBackupDir() {
    if (!backupDir)
        throw new Error("[hedgehog-app] backupDir not initialized");
    return backupDir;
}
export function getHedgehogRuntime() {
    if (!runtime)
        throw new Error("[hedgehog-app] runtime not initialized");
    return runtime;
}
//# sourceMappingURL=runtime.js.map