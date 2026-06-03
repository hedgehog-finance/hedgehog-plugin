import { allFeaturesTools } from "./features/index.js";
export const HEDGEHOG_AGENT_ID = "hedgehog-finance";
export function listRegisteredAgentToolNames() {
    return Object.entries(allFeaturesTools)
        .filter(([, tool]) => tool.registerTool !== false)
        .map(([name]) => name);
}
//# sourceMappingURL=openclawConstants.js.map