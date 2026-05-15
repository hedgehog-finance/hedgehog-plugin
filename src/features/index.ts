import { watchlistTools } from "./watchlist/tools.js";

export interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx: { userId: string }): Promise<string>;
}

export const allFeaturesTools: Record<string, RuntimeTool> = {
    ...watchlistTools
};
