import { z } from "zod";

export const DailyMorningBriefingStatusSchema = z.enum(["generating", "completed", "failed"]);

export const SaveDailyMorningBriefingParamsSchema = z.object({
	id: z.string().trim().min(1).optional().describe("每日早报 ID；开始生成时不传，后续更新状态时传入"),
	content: z.string().default("").describe("每日早报最终内容；失败时存入错误信息"),
	status: DailyMorningBriefingStatusSchema.default("completed").describe("保存状态：generating 生成中，completed 成功，failed 失败")
}).refine((value) => {
	if (value.status === "completed") return value.content.trim().length > 0;
	return true;
}, {
	message: "completed 状态必须提供 content"
});
export type SaveDailyMorningBriefingParams = z.infer<typeof SaveDailyMorningBriefingParamsSchema>;

export const QueryDailyMorningBriefingsParamsSchema = z.object({
	market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
	page: z.number().int().min(1).default(1).describe("页码"),
	pageSize: z.number().int().min(1).max(50).default(10).describe("每页数量，默认 10")
});
export type QueryDailyMorningBriefingsParams = z.infer<typeof QueryDailyMorningBriefingsParamsSchema>;

export const GetDailyMorningBriefingDetailParamsSchema = z.object({
	id: z.string().trim().min(1).describe("每日早报 ID")
});
export type GetDailyMorningBriefingDetailParams = z.infer<typeof GetDailyMorningBriefingDetailParamsSchema>;

export interface DailyMorningBriefing {
	id: string;
	market: string;
	briefingDate: string;
	content: string;
	status: string;
	watchlistSnapshot: unknown[];
	createdAt: string;
	updatedAt: string;
}
