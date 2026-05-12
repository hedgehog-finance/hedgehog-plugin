import { z } from "zod";
/**
 * Hedgehog Finance Resolved Account
 */
export interface HedgehogFinanceResolvedAccount {
    accountId: string;
    config: {
        token: string;
        code: string;
    };
    enabled: boolean;
    configured: boolean;
}
/**
 * Inbound Message from Relay (Manual Handling)
 */
export interface RelayInboundMessage {
    type: "req" | "reply" | "item_event" | "usage" | "model" | "reasoning";
    from: string;
    chatId: string;
    id: string;
    text?: string;
    method?: string;
    params?: any;
    replyTo?: string;
}
/**
 * Session entry structure in sessions.json
 */
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
/**
 * Normalized Usage for UI and Internal logic
 */
export interface TurnUsage {
    input: number;
    output: number;
    total: number;
    cacheRead: number;
    cost: number;
    model: string;
    provider: string;
}
/**
 * Stock Classification Result (AI Schema)
 */
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
