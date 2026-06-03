import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { jsonResult } from "openclaw/plugin-sdk/core";
import { hedgehogFinancePlugin } from "./src/channel.js";
import { setHedgehogRuntime } from "./src/runtime.js";
import { allFeaturesTools } from "./src/features/index.js";
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
                try {
                    return jsonResult(JSON.parse(result));
                }
                catch {
                    return jsonResult({ success: true, data: result });
                }
            }
        };
        api.registerTool(registerable, { name });
    });
}
export default defineChannelPluginEntry({
    id: "hedgehog_finance",
    name: "Hedgehog Finance Comprehensive Plugin",
    description: "WebSocket Channel & Watchlist SQLite Tools for Hedgehog App",
    plugin: hedgehogFinancePlugin,
    setRuntime(runtime) {
        setHedgehogRuntime(runtime);
    },
    registerCliMetadata(api) {
        registerFeatureTools(api);
    },
    registerFull(api) {
        setHedgehogRuntime(api.runtime);
        registerFeatureTools(api);
    },
});
//# sourceMappingURL=index.js.map