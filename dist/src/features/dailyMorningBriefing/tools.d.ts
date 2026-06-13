interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx?: RuntimeToolContext): Promise<string>;
}
type RuntimeToolContext = {
    userId?: string;
    sessionKey?: string;
    sessionId?: string;
    runId?: string;
};
export declare const dailyMorningBriefingTools: Record<string, RuntimeTool>;
export {};
