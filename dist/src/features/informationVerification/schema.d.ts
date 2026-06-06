import { z } from "zod";
export declare const BuildInformationVerificationMessageParamsSchema: z.ZodObject<{
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
