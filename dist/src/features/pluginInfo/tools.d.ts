interface RuntimeTool {
    name: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx: {
        userId: string;
    }): Promise<string>;
}
export declare const pluginInfoTools: Record<string, RuntimeTool>;
export {};
