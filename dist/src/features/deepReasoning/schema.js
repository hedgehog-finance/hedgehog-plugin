import { z } from "zod";
export const BuildDeepReasoningMessageParamsSchema = z.object({
    newsId: z.string().trim().min(1).describe("新闻 ID，例如 news-5"),
    sourceTitle: z.string().trim().min(1).describe("新闻标题"),
    sourceContent: z.string().trim().min(1).describe("新闻正文"),
    sessionId: z.string().trim().optional().default("").describe("前端生成的会话 ID")
});
export const BuildDeepReasoningMessageAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    required: ["newsId", "sourceTitle", "sourceContent"],
    properties: {
        newsId: { type: "string", description: "新闻 ID，例如 news-5" },
        sourceTitle: { type: "string", description: "新闻标题" },
        sourceContent: { type: "string", description: "新闻正文" },
        sessionId: { type: "string", description: "前端生成的会话 ID" }
    }
};
export const QueryDeepReasoningHistoryParamsSchema = z.object({
    page: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(50).default(10).describe("每页数量，默认 10")
});
export const GetDeepReasoningDetailParamsSchema = z.object({
    id: z.string().trim().min(1).optional().describe("记录 ID"),
    sourceId: z.string().trim().min(1).optional().describe("新闻来源 ID，例如 news-5")
}).refine((value) => value.id || value.sourceId, {
    message: "id 或 sourceId 至少提供一个"
});
export const GetDeepReasoningDetailBySessionParamsSchema = z.object({
    sessionId: z.string().trim().min(1).describe("前端生成的会话 ID"),
    sourceId: z.string().trim().min(1).describe("新闻来源 ID，例如 news-5")
});
//# sourceMappingURL=schema.js.map