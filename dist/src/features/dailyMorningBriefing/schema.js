import { z } from "zod";
export const DispatchDailyMorningBriefingAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {}
};
export const BuildDailyMorningBriefingMessageParamsSchema = z.object({
    sessionId: z.string().trim().optional().default("").describe("兼容字段，当前不参与会话选择。每日盘前早报统一由后端调度到固定业务会话。")
});
export const BuildDailyMorningBriefingMessageAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        sessionId: { type: "string", description: "兼容字段，当前不参与会话选择。每日盘前早报统一由后端调度到固定业务会话。" }
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