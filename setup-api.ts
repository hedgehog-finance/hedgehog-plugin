import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { ensureRegisteredToolsAllowedInConfig } from "./src/openclawConfig.js";

function migrateDailyBriefingAgentTools(config: OpenClawConfig): { config: OpenClawConfig; changes: string[] } | null {
	return ensureRegisteredToolsAllowedInConfig(config);
}

export default function register(api: OpenClawPluginApi): void {
	api.registerConfigMigration(migrateDailyBriefingAgentTools);
}
