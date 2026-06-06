import { allFeaturesTools } from "./features/index.js";

export const HEDGEHOG_AGENT_ID = "hedgehog-finance";
export const MAIN_AGENT_ID = "main";
export const MAIN_AGENT_EXTRA_TOOL_NAMES = ["update_hedgehog_skill_versions"];

export function listRegisteredAgentToolNames(): string[] {
	return Object.entries(allFeaturesTools)
		.filter(([, tool]) => tool.registerTool !== false && tool.agentToolTarget !== "main")
		.map(([name]) => name);
}
