import { z } from "openclaw/plugin-sdk/zod";
export declare const SaveDailyMorningBriefingParamsSchema: z.ZodObject<{
    content: z.ZodString;
}, z.core.$strip>;
export type SaveDailyMorningBriefingParams = z.infer<typeof SaveDailyMorningBriefingParamsSchema>;
export declare const QueryDailyMorningBriefingsParamsSchema: z.ZodObject<{
    market: z.ZodDefault<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type QueryDailyMorningBriefingsParams = z.infer<typeof QueryDailyMorningBriefingsParamsSchema>;
export interface DailyMorningBriefing {
    id: string;
    market: string;
    briefingDate: string;
    content: string;
    watchlistSnapshot: unknown[];
    createdAt: string;
    updatedAt: string;
}
