interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx: {
        userId: string;
    }): Promise<string>;
}
export declare const noteTools: Record<string, RuntimeTool>;
export {};
