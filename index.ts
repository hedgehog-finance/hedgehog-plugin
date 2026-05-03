import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { ciweiAIPlugin } from "./src/channel";
import { setCiweiAIRuntime } from "./src/runtime";
import { allFeaturesTools } from "./src/features";

export default defineChannelPluginEntry({
	id: "ciwei-ai",
	name: "Ciwei AI Comprehensive Plugin",
	description: "WebSocket Channel & Watchlist SQLite Tools",
	plugin: ciweiAIPlugin,
	setRuntime(runtime) {
		setCiweiAIRuntime(runtime);
	},
	registerFull(api) {
		// 1. 自动化循环注册 Tool
		Object.entries(allFeaturesTools).forEach(([name, tool]) => {
			const registerable = { ...tool, label: tool.description };
			api.registerTool(registerable as any, { name });
		});

		api.logger.info("Ciwei AI: Registered tools and runtime context.");
	},
});

