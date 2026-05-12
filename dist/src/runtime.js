import path from "path";
import * as os from "node:os";
import { logger } from "./core/logger.js";
let runtime = null;
let dbPath = "";
let backupDir = "";
export function setHedgehogRuntime(next) {
    runtime = next;
    try {
        // 从配置里读取 hedgehog-finance 的 workspace
        const cfg = next.config.loadConfig();
        const agentList = (cfg.agents?.list || []);
        const hedgehogAgent = agentList.find((a) => a.id === "hedgehog-finance");
        const workspaceDir = hedgehogAgent?.workspace ||
            cfg.agents?.defaults?.workspace ||
            path.join(os.homedir(), ".openclaw", "hedgehog-workspace");
        dbPath = path.join(workspaceDir, "data", "business.db");
        backupDir = path.join(workspaceDir, "backups");
        logger.info({ workspaceDir, dbPath }, "resolved workspace");
    }
    catch (e) {
        logger.error({ err: e }, "Failed to resolve workspace");
    }
}
export function getDbPath() {
    if (!dbPath)
        throw new Error("[hedgehog-app] dbPath not initialized");
    return dbPath;
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