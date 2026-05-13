import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { hedgehogFinancePlugin } from "./src/channel.js";
import { setHedgehogRuntime } from "./src/runtime.js";
import { allFeaturesTools } from "./src/features/index.js";
export default defineChannelPluginEntry({
    id: "hedgehog_finance",
    name: "Hedgehog Finance Comprehensive Plugin",
    description: "WebSocket Channel & Watchlist SQLite Tools for Hedgehog App",
    plugin: hedgehogFinancePlugin,
    setRuntime(runtime) {
        setHedgehogRuntime(runtime);
    },
    registerFull(api) {
        Object.entries(allFeaturesTools).forEach(([name, tool]) => {
            if (tool.registerTool === false)
                return;
            const registerable = { ...tool, label: tool.description };
            api.registerTool(registerable, { name });
        });
        api.logger.info("[hedgehog-app] Registered tools and runtime context.");
    },
});
//# sourceMappingURL=index.js.map