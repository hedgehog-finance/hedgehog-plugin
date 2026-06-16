import { z } from "zod";
export const DailyMorningBriefingStatusSchema = z.enum(["generating", "completed", "failed"]);
export const SaveDailyMorningBriefingParamsSchema = z.object({
    id: z.string().trim().min(1).optional().describe("每日早报 ID；开始生成时不传，后续更新状态时传入"),
    content: z.string().default("").describe("每日早报最终内容；失败时存入错误信息"),
    status: DailyMorningBriefingStatusSchema.default("completed").describe("保存状态：generating 生成中，completed 成功，failed 失败")
}).refine((value) => {
    if (value.status === "completed")
        return value.content.trim().length > 0;
    return true;
}, {
    message: "completed 状态必须提供 content"
});
export const SaveDailyMorningBriefingAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: { type: "string", description: "每日盘前早报 ID；开始生成时不传，后续更新生成结果时必须传入开始时返回的 id" },
        content: { type: "string", description: "每日盘前早报正文；status=generating 时为空，status=failed 时存入错误信息" },
        status: { type: "string", enum: ["generating", "completed", "failed"], description: "保存状态：generating 表示开始生成，completed 表示生成成功，failed 表示生成失败" }
    }
};
export const DispatchDailyMorningBriefingAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {}
};
export const BuildDailyMorningBriefingMessageParamsSchema = z.object({
    sessionId: z.string().trim().optional().default("").describe("前端生成的会话 ID；不传则使用每日早报固定会话 ID")
});
export const BuildDailyMorningBriefingMessageAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        sessionId: { type: "string", description: "前端生成的会话 ID；不传则使用每日早报固定会话 ID" }
    }
};
export const QueryDailyMorningBriefingsParamsSchema = z.object({
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
    page: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(50).default(10).describe("每页数量，默认 10")
});
export const GetDailyMorningBriefingDetailParamsSchema = z.object({
    id: z.string().trim().min(1).describe("每日早报 ID")
});
//# sourceMappingURL=schema.js.map