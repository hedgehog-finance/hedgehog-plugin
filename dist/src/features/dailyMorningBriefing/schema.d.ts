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
export declare const SaveDailyMorningBriefingAgentToolSchema: {
    type: string;
    additionalProperties: boolean;
    properties: {
        id: {
            type: string;
            description: string;
        };
        content: {
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
export declare const DispatchDailyMorningBriefingAgentToolSchema: {
    type: string;
    additionalProperties: boolean;
    properties: {};
};
export declare const BuildDailyMorningBriefingMessageParamsSchema: z.ZodObject<{
    sessionId: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
}, {
    sessionId?: string | undefined;
}>;
export type BuildDailyMorningBriefingMessageParams = z.infer<typeof BuildDailyMorningBriefingMessageParamsSchema>;
export declare const BuildDailyMorningBriefingMessageAgentToolSchema: {
    type: string;
    additionalProperties: boolean;
    properties: {
        sessionId: {
            type: string;
            description: string;
        };
    };
};
export type RuntimeToolContext = {
    userId?: string;
    sessionKey?: string;
    sessionId?: string;
    runId?: string;
};
export interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx?: RuntimeToolContext): Promise<string>;
}
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
    sessionId: string;
    watchlistSnapshot: unknown[];
    createdAt: string;
    updatedAt: string;
}
export type DailyMorningBriefingDispatchDecision = {
    action: "skip";
    reason: "before_start_time" | "already_completed" | "already_generating" | "nudge_throttled" | "retry_cooling_down" | "max_attempts_reached";
    data?: DailyMorningBriefing;
    nextRetryAt?: string;
} | {
    action: "continue";
    data: DailyMorningBriefing;
    idempotencyKey: string;
} | {
    action: "start";
    data: DailyMorningBriefing;
    idempotencyKey: string;
};
