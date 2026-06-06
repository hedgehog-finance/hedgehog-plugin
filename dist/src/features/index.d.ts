export interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    agentToolTarget?: "main";
    execute(params: unknown, ctx?: {
        userId: string;
    }): Promise<string>;
}
export declare const allFeaturesTools: Record<string, RuntimeTool>;
