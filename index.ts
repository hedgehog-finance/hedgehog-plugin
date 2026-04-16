// index.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/channel-plugin-common";
import { ciweiAIPlugin } from "./src/channel";
import { setCiweiAIRuntime } from "./src/runtime";
import { allFeaturesTools } from "./src/features";

let registered = false;

export default {
	id: "ciwei-ai",
	name: "Ciwei AI Comprehensive Plugin",
	description: "WebSocket Channel & Watchlist SQLite Tools",
	configSchema: emptyPluginConfigSchema(),

	register(api: OpenClawPluginApi): void {
		if (registered) return;
		registered = true;

		// 1. 初始化 Runtime 环境（dbPath, backupDir 等）
		setCiweiAIRuntime(api.runtime);

		// 2. 注册 WebSocket 频道（处理对话流）
		api.registerChannel({ plugin: ciweiAIPlugin });

		// 3. 自动化循环注册：双向映射 (Tool & GatewayMethod)
		Object.entries(allFeaturesTools).forEach(([name, tool]) => {
			// Spread into a fresh object with `label` (required by AgentTool).
			// Assigning to a const bypasses excess-property checking.
			const registerable = { ...tool, label: tool.description };
			api.registerTool(registerable as unknown as Parameters<typeof api.registerTool>[0], { name });
		});

		console.log("[ciwei-ai] 已完成标准 Tool 与 GatewayMethod 的同步注册。");
	},
};
