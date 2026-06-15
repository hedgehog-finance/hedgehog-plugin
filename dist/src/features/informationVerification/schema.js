import { z } from "zod";
export const InformationVerificationStatusSchema = z.enum(["generating", "completed", "failed"]);
export const BuildInformationVerificationMessageParamsSchema = z.object({
    newsId: z.string().trim().min(1).describe("新闻 ID，例如 news-5"),
    sourceTitle: z.string().trim().min(1).describe("新闻标题"),
    publishTime: z.string().trim().optional().default("").describe("新闻发布时间"),
    sourceContent: z.string().trim().min(1).describe("新闻正文"),
    sessionId: z.string().trim().optional().default("").describe("前端生成的会话 ID")
});
export const BuildInformationVerificationMessageAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    required: ["newsId", "sourceTitle", "sourceContent"],
    properties: {
        newsId: { type: "string", description: "新闻 ID，例如 news-5" },
        sourceTitle: { type: "string", description: "新闻标题" },
        publishTime: { type: "string", description: "新闻发布时间" },
        sourceContent: { type: "string", description: "新闻正文" },
        sessionId: { type: "string", description: "前端生成的会话 ID" }
    }
};
export const QueryInformationVerificationHistoryParamsSchema = z.object({
    page: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(50).default(10).describe("每页数量，默认 10")
});
export const GetInformationVerificationDetailParamsSchema = z.object({
    id: z.string().trim().min(1).optional().describe("记录 ID"),
    sourceId: z.string().trim().min(1).optional().describe("新闻来源 ID，例如 news-5")
}).refine((value) => value.id || value.sourceId, {
    message: "id 或 sourceId 至少提供一个"
});
export const GetInformationVerificationDetailBySessionParamsSchema = z.object({
    sessionId: z.string().trim().min(1).describe("前端生成的会话 ID"),
    sourceId: z.string().trim().min(1).describe("新闻来源 ID，例如 news-5")
});
export const SaveInformationVerificationParamsSchema = z.object({
    sourceId: z.string().trim().min(1).describe("新闻来源 ID，例如 news-5"),
    sourceTitle: z.string().trim().optional().default("").describe("新闻标题；status=generating 时必须提供"),
    sessionId: z.string().trim().optional().default("").describe("前端生成的会话 ID"),
    content: z.string().default("").describe("AI 分析内容；status=generating 时为空，status=failed 时存入错误信息"),
    status: InformationVerificationStatusSchema.default("completed").describe("保存状态：generating 生成中，completed 成功，failed 失败")
}).strict().refine((value) => {
    if (value.status === "completed")
        return value.content.trim().length > 0;
    return true;
}, {
    message: "completed 状态必须提供 content"
}).refine((value) => {
    if (value.status !== "generating")
        return true;
    return value.sourceTitle.trim().length > 0;
}, {
    message: "generating 状态必须提供 sourceTitle"
});
//# sourceMappingURL=schema.js.map