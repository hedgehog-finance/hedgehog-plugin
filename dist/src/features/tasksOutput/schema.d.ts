export interface SaveTasksOutputParams {
    sessionId: string;
    saveStrategy: "update" | "overwrite";
    output: string;
    status?: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled" | "skipped" | "generating";
}
export interface QueryTasksOutputParams {
    taskId?: string;
    workflowId?: string;
    sessionId?: string;
    page: number;
    pageSize: number;
}
export interface GetTasksOutputParams {
    sessionId: string;
}
export declare const SaveTasksOutputParamsSchema: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        sessionId: {
            type: string;
            minLength: number;
            description: string;
        };
        saveStrategy: {
            type: string;
            enum: string[];
            description: string;
        };
        output: {
            type: string;
            description: string;
        };
        status: {
            type: string;
            enum: string[];
            description: string;
        };
    };
};
export declare const GetTasksOutputParamsSchema: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        sessionId: {
            type: string;
            minLength: number;
            description: string;
        };
    };
};
export declare const QueryTasksOutputParamsSchema: {
    type: string;
    additionalProperties: boolean;
    properties: {
        taskId: {
            type: string;
            minLength: number;
            description: string;
        };
        workflowId: {
            type: string;
            minLength: number;
            description: string;
        };
        sessionId: {
            type: string;
            minLength: number;
            description: string;
        };
        page: {
            type: string;
            minimum: number;
            default: number;
            description: string;
        };
        pageSize: {
            type: string;
            minimum: number;
            maximum: number;
            default: number;
            description: string;
        };
    };
};
export interface TasksOutput {
    taskId: string;
    workflowId: string;
    sessionId: string;
    output: string;
    createdAt: string;
    updatedAt: string;
}
export interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx?: {
        userId?: string;
    }): Promise<string>;
}
