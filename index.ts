import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { hedgehogFinancePlugin } from "./src/channel";
import { setHedgehogRuntime } from "./src/runtime";
import { allFeaturesTools } from "./src/features";

export default defineChannelPluginEntry({
	id: "hedgehog_finance",
	name: "Hedgehog Finance Comprehensive Plugin",
	description: "WebSocket Channel & Watchlist SQLite Tools for Hedgehog App",
	plugin: hedgehogFinancePlugin,
	setRuntime(runtime) {
		setHedgehogRuntime(runtime);
	},
	registerFull(api) {
		// 1. 自动化循环注册 Tool
		Object.entries(allFeaturesTools).forEach(([name, tool]) => {
			if (tool.registerTool === false) return;
			const registerable = { ...tool, label: tool.description };
			api.registerTool(registerable as any, { name });
		});

		api.logger.info("[hedgehog-app] Registered tools and runtime context.");
	},
});
