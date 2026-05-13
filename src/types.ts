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
    type: "req" | "reply" | "item_event" | "usage" | "model" | "reasoning";
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

export const StockClassificationSchema = z.object({
    industry: z.object({
        name: z.string(),
        weight: z.number().min(0).max(100).default(50)
    }).describe("Required main industry category with weight"),
    theme: z.array(z.object({
        name: z.string(),
        weight: z.number().min(0).max(100).default(50)
    })).describe("Thematic categories with weights"),
    weight: z.number().min(0).max(100).default(50).describe("Overall priority weight")
});

export type StockClassification = z.infer<typeof StockClassificationSchema>;
