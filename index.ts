// index.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/channel-plugin-common";
import { ciweiAIPlugin } from "./src/channel";
import { setCiweiAIRuntime } from "./src/runtime";
import { watchlistTools } from "./src/watchlist";

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
		Object.entries(watchlistTools).forEach(([name, tool]) => {

			/**
			 * 注册为大模型工具 (registerTool)
			 * 按照 api.registerTool(tool, opts) 签名：
			 * 第一个参数为包含 execute 的对象，第二个参数传入元数据。
			 */
			api.registerTool(tool, { name: name });
		});

		console.log("[ciwei-ai] 已完成标准 Tool 与 GatewayMethod 的同步注册。");
	},
};
