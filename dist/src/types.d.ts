import { z } from "zod";
export interface HedgehogFinanceResolvedAccount {
    accountId: string;
    config: {
        token: string;
        code: string;
    };
    enabled: boolean;
    configured: boolean;
}
export interface RelayInboundMessage {
    type: "req" | "reply" | "assistant_message_start" | "item_event" | "tool_start" | "tool_result" | "command_output" | "usage" | "model" | "reasoning" | "reasoning_end";
    from: string;
    chatId: string;
    id: string;
    text?: string;
    method?: string;
    params?: any;
    replyTo?: string;
}
export interface OpenClawSessionEntry {
    sessionId: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheRead?: number;
    estimatedCostUsd?: number;
    model?: string;
    modelProvider?: string;
    updatedAt?: number;
}
export interface TurnUsage {
    input: number;
    output: number;
    total: number;
    cacheRead: number;
    cost: number;
    model: string;
    provider: string;
}
export declare const StockClassificationSchema: z.ZodObject<{
    industry: z.ZodObject<{
        name: z.ZodString;
        weight: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        weight: number;
    }, {
        name: string;
        weight?: number | undefined;
    }>;
    theme: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        weight: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        weight: number;
    }, {
        name: string;
        weight?: number | undefined;
    }>, "many">;
    weight: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    weight: number;
    industry: {
        name: string;
        weight: number;
    };
    theme: {
        name: string;
        weight: number;
    }[];
}, {
    industry: {
        name: string;
        weight?: number | undefined;
    };
    theme: {
        name: string;
        weight?: number | undefined;
    }[];
    weight?: number | undefined;
}>;
export type StockClassification = z.infer<typeof StockClassificationSchema>;
