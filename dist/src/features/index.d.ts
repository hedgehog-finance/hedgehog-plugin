/**
 * Runtime tool shape used for dynamic RPC dispatch and registerTool.
 *
 * - `label` is required by OpenClaw's AgentTool interface.
 * - `execute` uses bivariant-friendly method syntax so that
 *   specific param types (AddToWatchlistParams etc.) are assignable
 *   without fighting TypeScript's strict function contravariance.
 */
export interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx: {
        userId: string;
    }): Promise<string>;
}
/**
 * Aggregated export of all tools across all features.
 */
export declare const allFeaturesTools: Record<string, RuntimeTool>;
