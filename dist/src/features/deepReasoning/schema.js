import { z } from "zod";
export const BuildDeepReasoningMessageParamsSchema = z.object({
    newsId: z.string().trim().min(1).describe("新闻 ID，例如 news-5"),
    sourceTitle: z.string().trim().min(1).describe("新闻标题"),
    sourceContent: z.string().trim().min(1).describe("新闻正文")
});
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
//# sourceMappingURL=schema.js.map