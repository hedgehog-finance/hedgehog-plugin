import { z } from "zod";


export const BuildInformationVerificationMessageParamsSchema = z.object({
	newsId: z.string().trim().min(1).describe("新闻 ID，例如 news-5"),
	sourceTitle: z.string().trim().min(1).describe("新闻标题"),
	publishTime: z.string().trim().optional().default("").describe("新闻发布时间"),
	sourceContent: z.string().trim().min(1).describe("新闻正文"),
	sessionId: z.string().trim().optional().default("").describe("前端生成的会话 ID")
});
export type BuildInformationVerificationMessageParams = z.infer<typeof BuildInformationVerificationMessageParamsSchema>;

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

export interface RuntimeTool {
	name: string;
	label?: string;
	description: string;
	parameters: unknown;
	registerTool?: boolean;
	execute(params: unknown, ctx?: { userId: string }): Promise<string>;
}

export const QueryInformationVerificationHistoryParamsSchema = z.object({
	page: z.number().int().min(1).default(1).describe("页码"),
	pageSize: z.number().int().min(1).max(50).default(10).describe("每页数量，默认 10")
});
export type QueryInformationVerificationHistoryParams = z.infer<typeof QueryInformationVerificationHistoryParamsSchema>;

export const GetInformationVerificationDetailParamsSchema = z.object({
	id: z.string().trim().min(1).optional().describe("记录 ID"),
	sourceId: z.string().trim().min(1).optional().describe("新闻来源 ID，例如 news-5")
}).refine((value) => value.id || value.sourceId, {
	message: "id 或 sourceId 至少提供一个"
});
export type GetInformationVerificationDetailParams = z.infer<typeof GetInformationVerificationDetailParamsSchema>;

export const GetInformationVerificationDetailBySessionParamsSchema = z.object({
	sessionId: z.string().trim().min(1).describe("前端生成的会话 ID"),
	sourceId: z.string().trim().min(1).describe("新闻来源 ID，例如 news-5")
});
export type GetInformationVerificationDetailBySessionParams = z.infer<typeof GetInformationVerificationDetailBySessionParamsSchema>;

