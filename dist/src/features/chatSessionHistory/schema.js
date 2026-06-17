import { z } from "zod";
export const QueryChatSessionHistoryParamsSchema = z.object({
    sessionId: z.string().trim().min(1).optional().describe("普通聊天会话标识，对应前端 chatId。查询普通会话时必填；查询每日盘前早报会话时不使用。"),
    dailyMorningBriefingId: z.string().trim().min(1).optional().describe("每日盘前早报记录 ID，格式为 daily_morning_briefing_<market>_<date>。查询早报生成会话时使用该字段解析实际 OpenClaw sessionKey。"),
    interactionId: z.string().trim().optional().describe("可选交互标识，用于定位指定 turn；通常对应前端发送消息时生成的 inboundId 或 turnId。"),
    agentId: z.string().trim().optional().describe("可选 Agent ID。普通聊天默认由 channel routing 解析；早报会话默认使用 hedgehog-finance。"),
    limit: z.number().int().positive().max(1000).optional().default(20).describe("返回消息数量上限。"),
    includeTools: z.boolean().optional().default(false),
    includeEmptyAssistant: z.boolean().optional().default(false).describe("是否保留没有可见文本的 assistant 消息。默认 false，仅返回可展示的 assistant 文本。"),
    includeRaw: z.boolean().optional().default(false)
}).refine((args) => Boolean(args.sessionId || args.dailyMorningBriefingId), {
    message: "sessionId or dailyMorningBriefingId is required",
    path: ["sessionId"]
});
//# sourceMappingURL=schema.js.map