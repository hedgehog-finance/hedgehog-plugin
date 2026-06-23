import { z } from "zod";
export declare const BuildInformationVerificationMessageParamsSchema: z.ZodObject<{
    newsId: z.ZodString;
    sourceTitle: z.ZodString;
    publishTime: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    sourceContent: z.ZodString;
    sessionId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    newsId: string;
    sourceTitle: string;
    publishTime: string;
    sourceContent: string;
}, {
    newsId: string;
    sourceTitle: string;
    sourceContent: string;
    sessionId?: string | undefined;
    publishTime?: string | undefined;
}>;
export type BuildInformationVerificationMessageParams = z.infer<typeof BuildInformationVerificationMessageParamsSchema>;
export declare const BuildInformationVerificationMessageAgentToolSchema: {
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
        publishTime: {
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
export declare const QueryInformationVerificationHistoryParamsSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    pageSize: number;
}, {
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type QueryInformationVerificationHistoryParams = z.infer<typeof QueryInformationVerificationHistoryParamsSchema>;
export declare const GetInformationVerificationDetailParamsSchema: z.ZodEffects<z.ZodObject<{
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
export type GetInformationVerificationDetailParams = z.infer<typeof GetInformationVerificationDetailParamsSchema>;
export declare const GetInformationVerificationDetailBySessionParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    sourceId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    sourceId: string;
}, {
    sessionId: string;
    sourceId: string;
}>;
export type GetInformationVerificationDetailBySessionParams = z.infer<typeof GetInformationVerificationDetailBySessionParamsSchema>;
