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
	sessionId: z.string().trim().optional().default("").describe("兼容字段，当前不参与会话选择。每日盘前早报统一由后端调度到固定业务会话。")
});
export type BuildDailyMorningBriefingMessageParams = z.infer<typeof BuildDailyMorningBriefingMessageParamsSchema>;

export const BuildDailyMorningBriefingMessageAgentToolSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		sessionId: { type: "string", description: "兼容字段，当前不参与会话选择。每日盘前早报统一由后端调度到固定业务会话。" }
	}
};

export type RuntimeToolContext = {
	userId?: string;
	sessionKey?: string;
	sessionId?: string;
	runId?: string;
};

export interface RuntimeTool {
	name: string;
	label?: string;
	description: string;
	parameters: unknown;
	registerTool?: boolean;
	execute(params: unknown, ctx?: RuntimeToolContext): Promise<string>;
}

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
	sessionId: string;
	watchlistSnapshot: unknown[];
	createdAt: string;
	updatedAt: string;
}

export type DailyMorningBriefingDispatchDecision =
	| { action: "skip"; reason: "before_start_time" | "already_completed" | "already_generating" | "nudge_throttled" | "retry_cooling_down" | "max_attempts_reached"; data?: DailyMorningBriefing; nextRetryAt?: string }
	| { action: "continue"; data: DailyMorningBriefing; idempotencyKey: string }
	| { action: "start"; data: DailyMorningBriefing; idempotencyKey: string };
