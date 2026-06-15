import { z } from "zod";
export const DeepReasoningStatusSchema = z.enum(["generating", "completed", "failed"]);
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
export const SaveDeepReasoningParamsSchema = z.object({
    sourceId: z.string().trim().min(1).describe("新闻来源 ID，例如 news-5"),
    sourceTitle: z.string().trim().optional().default("").describe("新闻标题；status=generating 时必须提供"),
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
    sessionId: z.string().trim().optional().default("").describe("前端生成的会话 ID"),
    content: z.string().default("").describe("AI 分析内容；status=generating 时为空，status=failed 时存入错误信息"),
    status: DeepReasoningStatusSchema.default("completed").describe("保存状态：generating 生成中，completed 成功，failed 失败")
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
export const SaveDeepReasoningAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    required: ["sourceId"],
    properties: {
        sourceId: { type: "string", description: "新闻来源 ID，例如 news-5" },
        sourceTitle: { type: "string", description: "新闻标题；status=generating 时必须提供" },
        market: { type: "string", description: "市场类型，默认 CN" },
        sessionId: { type: "string", description: "前端生成的会话 ID" },
        content: { type: "string", description: "AI 分析内容；status=generating 时为空，status=failed 时存入错误信息" },
        status: { type: "string", enum: ["generating", "completed", "failed"], description: "保存状态：generating 表示生成中，completed 表示生成成功，failed 表示生成失败" }
    }
};
//# sourceMappingURL=schema.js.map