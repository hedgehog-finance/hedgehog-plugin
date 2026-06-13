import { z } from "zod";
export const QueryChatSessionHistoryParamsSchema = z.object({
    sessionId: z.string().trim().min(1).describe("前端 Chat 页创建的会话 ID；当前等同于 chatId"),
    interactionId: z.string().trim().optional().describe("可选交互 ID；前端发送消息时生成的 inboundId/turnId"),
    agentId: z.string().trim().optional().describe("可选 Agent ID；默认按 channel 路由解析"),
    limit: z.number().int().positive().max(1000).optional().default(20).describe("最后一次交互返回消息数的安全上限"),
    includeTools: z.boolean().optional().default(false),
    includeRaw: z.boolean().optional().default(false)
});
//# sourceMappingURL=schema.js.map