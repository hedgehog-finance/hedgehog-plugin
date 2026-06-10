import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { jsonResult, type AnyAgentTool, type OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { hedgehogFinancePlugin } from "./src/channel.js";
import { setHedgehogRuntime } from "./src/runtime.js";
import { allFeaturesTools } from "./src/features/index.js";
import { getDB } from "./src/core/database.js";
import { logger } from "./src/core/logger.js";
import { registerDailyMorningBriefingCron } from "./src/dailyMorningBriefingCron.js";

const registeredToolApis = new WeakSet<OpenClawPluginApi>();
const registeredToolContextApis = new WeakSet<OpenClawPluginApi>();

type ToolExecutionContext = {
	agentId?: string;
	sessionKey?: string;
	sessionId?: string;
	runId?: string;
};

const toolExecutionContexts = new Map<string, ToolExecutionContext>();

function registerToolContextCapture(api: OpenClawPluginApi): void {
	if (registeredToolContextApis.has(api)) return;
	registeredToolContextApis.add(api);

	api.on("before_tool_call", (_event, ctx) => {
		if (!ctx.toolCallId) return;
		toolExecutionContexts.set(ctx.toolCallId, {
			agentId: ctx.agentId,
			sessionKey: ctx.sessionKey,
			sessionId: ctx.sessionId,
			runId: ctx.runId
		});
	});

	api.on("after_tool_call", (event) => {
		if (event.toolCallId) toolExecutionContexts.delete(event.toolCallId);
	});
}

function registerFeatureTools(api: OpenClawPluginApi): void {
	if (registeredToolApis.has(api)) return;
	registeredToolApis.add(api);
	registerToolContextCapture(api);

	Object.entries(allFeaturesTools).forEach(([name, tool]) => {
		if (tool.registerTool === false && tool.agentToolTarget !== "main") return;
		const registerable: AnyAgentTool = {
			name,
			label: tool.label || tool.description,
			description: tool.description,
			parameters: tool.parameters as any,
			async execute(_toolCallId, params) {
				const result = await tool.execute(params, toolExecutionContexts.get(_toolCallId));
				const payload: unknown = JSON.parse(result);
				if (
					payload &&
					typeof payload === "object" &&
					"success" in payload &&
					payload.success === false
				) {
					const error = "error" in payload ? payload.error : undefined;
					throw new Error(typeof error === "string" ? error : `${name} failed`);
				}
				return jsonResult(payload);
			}
		};
		api.registerTool(registerable, { name });
	});
}

function initializeDatabase(): void {
	try {
		getDB();
	} catch (err) {
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
