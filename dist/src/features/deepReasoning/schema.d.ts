import { z } from "zod";
export declare const DeepReasoningStatusSchema: z.ZodEnum<["generating", "completed", "failed"]>;
export declare const BuildDeepReasoningMessageParamsSchema: z.ZodObject<{
    newsId: z.ZodString;
    sourceTitle: z.ZodString;
    sourceContent: z.ZodString;
    sessionId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    sourceTitle: string;
    sourceContent: string;
    newsId: string;
}, {
    sourceTitle: string;
    sourceContent: string;
    newsId: string;
    sessionId?: string | undefined;
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
export declare const SaveDeepReasoningParamsSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    sourceId: z.ZodString;
    sourceTitle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    market: z.ZodDefault<z.ZodString>;
    sessionId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    content: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["generating", "completed", "failed"]>>;
}, "strict", z.ZodTypeAny, {
    market: string;
    status: "generating" | "completed" | "failed";
    sessionId: string;
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    market?: string | undefined;
    status?: "generating" | "completed" | "failed" | undefined;
    sessionId?: string | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>, {
    market: string;
    status: "generating" | "completed" | "failed";
    sessionId: string;
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    market?: string | undefined;
    status?: "generating" | "completed" | "failed" | undefined;
    sessionId?: string | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>, {
    market: string;
    status: "generating" | "completed" | "failed";
    sessionId: string;
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    market?: string | undefined;
    status?: "generating" | "completed" | "failed" | undefined;
    sessionId?: string | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>;
export type SaveDeepReasoningParams = z.infer<typeof SaveDeepReasoningParamsSchema>;
