interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx?: {
        userId?: string;
        sessionKey?: string;
        sessionId?: string;
        runId?: string;
    }): Promise<string>;
}
export declare const dailyMorningBriefingTools: Record<string, RuntimeTool>;
export {};
