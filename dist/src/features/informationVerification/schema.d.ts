import { z } from "zod";
export declare const InformationVerificationStatusSchema: z.ZodEnum<["generating", "completed", "failed"]>;
export declare const BuildInformationVerificationMessageParamsSchema: z.ZodObject<{
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
export type BuildInformationVerificationMessageParams = z.infer<typeof BuildInformationVerificationMessageParamsSchema>;
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
export declare const SaveInformationVerificationParamsSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    sourceId: z.ZodString;
    sourceTitle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    sessionId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    content: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["generating", "completed", "failed"]>>;
}, "strict", z.ZodTypeAny, {
    status: "generating" | "completed" | "failed";
    sessionId: string;
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    status?: "generating" | "completed" | "failed" | undefined;
    sessionId?: string | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>, {
    status: "generating" | "completed" | "failed";
    sessionId: string;
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    status?: "generating" | "completed" | "failed" | undefined;
    sessionId?: string | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>, {
    status: "generating" | "completed" | "failed";
    sessionId: string;
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    status?: "generating" | "completed" | "failed" | undefined;
    sessionId?: string | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>;
export type SaveInformationVerificationParams = z.infer<typeof SaveInformationVerificationParamsSchema>;
