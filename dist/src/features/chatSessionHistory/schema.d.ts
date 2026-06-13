import { z } from "zod";
export declare const QueryChatSessionHistoryParamsSchema: z.ZodObject<{
    sessionId: z.ZodString;
    interactionId: z.ZodOptional<z.ZodString>;
    agentId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    includeTools: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    includeRaw: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    limit: number;
    includeTools: boolean;
    includeRaw: boolean;
    interactionId?: string | undefined;
    agentId?: string | undefined;
}, {
    sessionId: string;
    interactionId?: string | undefined;
    agentId?: string | undefined;
    limit?: number | undefined;
    includeTools?: boolean | undefined;
    includeRaw?: boolean | undefined;
}>;
export type QueryChatSessionHistoryParams = z.infer<typeof QueryChatSessionHistoryParamsSchema>;
