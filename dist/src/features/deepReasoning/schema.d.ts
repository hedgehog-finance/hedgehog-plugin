import { z } from "zod";
export declare const BuildDeepReasoningMessageParamsSchema: z.ZodObject<{
    newsId: z.ZodString;
    sourceTitle: z.ZodString;
    sourceContent: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sourceTitle: string;
    sourceContent: string;
    newsId: string;
}, {
    sourceTitle: string;
    sourceContent: string;
    newsId: string;
}>;
export type BuildDeepReasoningMessageParams = z.infer<typeof BuildDeepReasoningMessageParamsSchema>;
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
    sourceId?: string | undefined;
    id?: string | undefined;
}, {
    sourceId?: string | undefined;
    id?: string | undefined;
}>, {
    sourceId?: string | undefined;
    id?: string | undefined;
}, {
    sourceId?: string | undefined;
    id?: string | undefined;
}>;
export type GetDeepReasoningDetailParams = z.infer<typeof GetDeepReasoningDetailParamsSchema>;
