import { z } from "zod";
export declare const DailyMorningBriefingStatusSchema: z.ZodEnum<["generating", "completed", "failed"]>;
export declare const SaveDailyMorningBriefingParamsSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    content: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["generating", "completed", "failed"]>>;
}, "strip", z.ZodTypeAny, {
    status: "generating" | "completed" | "failed";
    content: string;
    id?: string | undefined;
}, {
    status?: "generating" | "completed" | "failed" | undefined;
    content?: string | undefined;
    id?: string | undefined;
}>, {
    status: "generating" | "completed" | "failed";
    content: string;
    id?: string | undefined;
}, {
    status?: "generating" | "completed" | "failed" | undefined;
    content?: string | undefined;
    id?: string | undefined;
}>;
export type SaveDailyMorningBriefingParams = z.infer<typeof SaveDailyMorningBriefingParamsSchema>;
export declare const QueryDailyMorningBriefingsParamsSchema: z.ZodObject<{
    market: z.ZodDefault<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    market: string;
    page: number;
    pageSize: number;
}, {
    market?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type QueryDailyMorningBriefingsParams = z.infer<typeof QueryDailyMorningBriefingsParamsSchema>;
export declare const GetDailyMorningBriefingDetailParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
}, {
    id: string;
}>;
export type GetDailyMorningBriefingDetailParams = z.infer<typeof GetDailyMorningBriefingDetailParamsSchema>;
export interface DailyMorningBriefing {
    id: string;
    market: string;
    briefingDate: string;
    content: string;
    status: string;
    watchlistSnapshot: unknown[];
    createdAt: string;
    updatedAt: string;
}
