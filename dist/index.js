import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { jsonResult } from "openclaw/plugin-sdk/core";
import { hedgehogFinancePlugin } from "./src/channel.js";
import { setHedgehogRuntime } from "./src/runtime.js";
import { allFeaturesTools } from "./src/features/index.js";
import { getDB } from "./src/core/database.js";
import { logger } from "./src/core/logger.js";
import { registerDailyMorningBriefingCron } from "./src/dailyMorningBriefingCron.js";
const registeredToolApis = new WeakSet();
function registerFeatureTools(api) {
    if (registeredToolApis.has(api))
        return;
    registeredToolApis.add(api);
    Object.entries(allFeaturesTools).forEach(([name, tool]) => {
        if (tool.registerTool === false)
            return;
        const registerable = {
            name,
            label: tool.label || tool.description,
            description: tool.description,
            parameters: tool.parameters,
            async execute(_toolCallId, params) {
                const result = await tool.execute(params);
                const payload = JSON.parse(result);
                if (payload &&
                    typeof payload === "object" &&
                    "success" in payload &&
                    payload.success === false) {
                    const error = "error" in payload ? payload.error : undefined;
                    throw new Error(typeof error === "string" ? error : `${name} failed`);
                }
                return jsonResult(payload);
            }
        };
        api.registerTool(registerable, { name });
    });
}
function initializeDatabase() {
    try {
        getDB();
    }
    catch (err) {
        logger.error({ err }, "Failed to initialize Hedgehog database");
    }
}
export default defineChannelPluginEntry({
    id: "hedgehog_finance",
    name: "Hedgehog Finance Comprehensive Plugin",
    description: "WebSocket Channel & Watchlist SQLite Tools for Hedgehog App",
    plugin: hedgehogFinancePlugin,
    setRuntime(runtime) {
        setHedgehogRuntime(runtime);
        initializeDatabase();
    },
    registerCliMetadata(api) {
        registerFeatureTools(api);
    },
    registerFull(api) {
        setHedgehogRuntime(api.runtime);
        initializeDatabase();
        registerDailyMorningBriefingCron(api);
        registerFeatureTools(api);
    },
});
//# sourceMappingURL=index.js.map