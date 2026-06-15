import { z } from "zod";
import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
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
export interface RuntimeTool {
    name: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx?: {
        userId?: string;
        runtime?: PluginRuntime;
    }): Promise<string>;
}
export type TranscriptMessage = {
    id: string;
    role: "user" | "assistant" | "tool" | string;
    text: string;
    thinking?: string;
    timestamp?: number | string;
    raw?: unknown;
};
export type SelectedInteraction = {
    messages: TranscriptMessage[];
    turnComplete: boolean;
    turnCompleteSource: "lifecycle" | "messages" | "none";
    lastUserMessageId: string | null;
    lastAssistantMessageId: string | null;
};
export type TranscriptEntry = {
    message: TranscriptMessage | null;
    raw: Record<string, unknown>;
};
