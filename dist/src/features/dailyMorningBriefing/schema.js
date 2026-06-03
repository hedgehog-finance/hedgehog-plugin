import { z } from "openclaw/plugin-sdk/zod";
export const SaveDailyMorningBriefingParamsSchema = z.object({
    content: z.string().trim().min(1).describe("每日早报最终内容")
});
export const QueryDailyMorningBriefingsParamsSchema = z.object({
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
    page: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(50).default(20).describe("每页数量")
});
//# sourceMappingURL=schema.js.map