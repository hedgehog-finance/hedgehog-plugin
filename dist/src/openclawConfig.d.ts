import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
export type HedgehogAgentToolAllowMigration = {
    config: OpenClawConfig;
    changes: string[];
};
export declare function ensureRegisteredToolsAllowedInConfig(config: OpenClawConfig): HedgehogAgentToolAllowMigration | null;
