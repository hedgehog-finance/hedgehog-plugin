import { ensureRegisteredToolsAllowedInConfig } from "./src/openclawConfig.js";
function migrateDailyBriefingAgentTools(config) {
    return ensureRegisteredToolsAllowedInConfig(config);
}
export default function register(api) {
    api.registerConfigMigration(migrateDailyBriefingAgentTools);
}
//# sourceMappingURL=setup-api.js.map