import { z } from "zod";
export declare const BuildDeepReasoningMessageParamsSchema: z.ZodObject<{
    newsId: z.ZodString;
    sourceTitle: z.ZodString;
    sourceContent: z.ZodString;
    sessionId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    newsId: string;
    sourceTitle: string;
    sourceContent: string;
}, {
    newsId: string;
    sourceTitle: string;
    sourceContent: string;
    sessionId?: string | undefined;
}>;
export type BuildDeepReasoningMessageParams = z.infer<typeof BuildDeepReasoningMessageParamsSchema>;
export declare const BuildDeepReasoningMessageAgentToolSchema: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        newsId: {
            type: string;
            description: string;
        };
        sourceTitle: {
            type: string;
            description: string;
        };
        sourceContent: {
            type: string;
            description: string;
        };
        sessionId: {
            type: string;
            description: string;
        };
    };
};
export interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx?: {
        userId: string;
    }): Promise<string>;
}
export declare const QueryDeepReasoningHistoryParamsSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    pageSize: number;
}, {
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type QueryDeepReasoningHistoryParams = z.infer<typeof QueryDeepReasoningHistoryParamsSchema>;
export declare const GetDeepReasoningDetailParamsSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    sourceId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id?: string | undefined;
    sourceId?: string | undefined;
}, {
    id?: string | undefined;
    sourceId?: string | undefined;
}>, {
    id?: string | undefined;
    sourceId?: string | undefined;
}, {
    id?: string | undefined;
    sourceId?: string | undefined;
}>;
export type GetDeepReasoningDetailParams = z.infer<typeof GetDeepReasoningDetailParamsSchema>;
export declare const GetDeepReasoningDetailBySessionParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    sourceId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    sourceId: string;
}, {
    sessionId: string;
    sourceId: string;
}>;
export type GetDeepReasoningDetailBySessionParams = z.infer<typeof GetDeepReasoningDetailBySessionParamsSchema>;
