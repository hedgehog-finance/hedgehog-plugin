import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
interface RuntimeTool {
    name: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx?: {
        userId?: string;
        runtime?: PluginRuntime;
    }): Promise<string>;
}
export declare const chatSessionHistoryTools: Record<string, RuntimeTool>;
export {};
