import { z } from "zod";

export const AiAnalysisStatusSchema = z.enum(["generating", "completed", "failed"]);

export const BuildStockAiAnalysisMessageParamsSchema = z.object({
	stock_code: z.string().trim().min(1).describe("股票代码"),
	stock_name: z.string().trim().min(1).describe("股票名称"),
	market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
	sessionId: z.string().trim().optional().default("").describe("前端生成的会话 ID")
});
export type BuildStockAiAnalysisMessageParams = z.infer<typeof BuildStockAiAnalysisMessageParamsSchema>;

export const GetStockAiAnalysisParamsSchema = z.object({
	stock_code: z.string().trim().min(1).describe("股票代码"),
	market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN")
});
export type GetStockAiAnalysisParams = z.infer<typeof GetStockAiAnalysisParamsSchema>;

export const GetStockAiAnalysisDetailParamsSchema = z.object({
	id: z.string().trim().min(1).describe("分析记录 ID")
});
export type GetStockAiAnalysisDetailParams = z.infer<typeof GetStockAiAnalysisDetailParamsSchema>;

export const GetStockAiAnalysisDetailBySessionParamsSchema = z.object({
	sessionId: z.string().trim().min(1).describe("前端生成的会话 ID"),
	stock_code: z.string().trim().min(1).describe("股票代码")
});
export type GetStockAiAnalysisDetailBySessionParams = z.infer<typeof GetStockAiAnalysisDetailBySessionParamsSchema>;

export const QueryStockAiAnalysisHistoryParamsSchema = z.object({
	stock_code: z.string().trim().min(1).optional().describe("股票代码，不传则查询全部"),
	market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
	page: z.number().int().min(1).default(1).describe("页码"),
	pageSize: z.number().int().min(1).max(50).default(10).describe("每页数量，默认 10")
});
export type QueryStockAiAnalysisHistoryParams = z.infer<typeof QueryStockAiAnalysisHistoryParamsSchema>;

export const QueryStockAiAnalysisStocksParamsSchema = z.object({
	market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
	page: z.number().int().min(1).default(1).describe("页码"),
	pageSize: z.number().int().min(1).max(100).default(50).describe("每页数量，默认 50")
});
export type QueryStockAiAnalysisStocksParams = z.infer<typeof QueryStockAiAnalysisStocksParamsSchema>;

export const SaveStockAiAnalysisParamsSchema = z.object({
	stock_code: z.string().trim().min(1).describe("股票代码"),
	stock_name: z.string().trim().optional().default("").describe("股票名称；status=generating 时必须提供"),
	market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
	sessionId: z.string().trim().optional().default("").describe("前端生成的会话 ID"),
	content: z.string().default("").describe("AI 分析内容；status=generating 时为空，status=failed 时存入错误信息"),
	status: AiAnalysisStatusSchema.default("completed").describe("保存状态：generating 生成中，completed 成功，failed 失败")
}).strict().refine((value) => {
	if (value.status === "completed") return value.content.trim().length > 0;
	return true;
}, {
	message: "completed 状态必须提供 content"
}).refine((value) => {
	if (value.status !== "generating") return true;
	return value.stock_name.trim().length > 0;
}, {
	message: "generating 状态必须提供 stock_name"
});
export type SaveStockAiAnalysisParams = z.infer<typeof SaveStockAiAnalysisParamsSchema>;

export interface StockAiAnalysis {
	id: string;
	stock_code: string;
	stock_name: string;
	market: string;
	sessionId: string;
	status: string;
	content: string;
	createdAt: string;
	updatedAt: string;
}

export type StockAiAnalysisWithoutContent = Omit<StockAiAnalysis, "content">;

export interface StockAiAnalysisStockSummary {
	stock_code: string;
	stock_name: string;
	market: string;
	latestAnalysisId: string;
	latestStatus: string;
	latestCreatedAt: string;
	latestUpdatedAt: string;
	analysisCount: number;
}

export const ArticleAiAnalysisKindSchema = z.enum(["verification", "deduction"]);
export const GetArticleAiAnalysisParamsSchema = z.object({
	sourceId: z.string().trim().min(1).describe("文章来源 ID，例如 news-5、report-5、announce-5"),
	analysisType: ArticleAiAnalysisKindSchema.describe("分析类型：verification 信息求证，deduction 深度推演"),
	market: z.string().trim().min(1).default("CN").describe("市场类型；深度推演使用，信息求证忽略")
});
export type GetArticleAiAnalysisParams = z.infer<typeof GetArticleAiAnalysisParamsSchema>;

export const QueryArticleAiAnalysisHistoryParamsSchema = z.object({
	analysisType: ArticleAiAnalysisKindSchema.describe("分析类型：verification 信息求证，deduction 深度推演"),
	market: z.string().trim().min(1).default("CN").describe("市场类型；深度推演使用，信息求证忽略"),
	page: z.number().int().min(1).default(1).describe("页码"),
	pageSize: z.number().int().min(1).max(50).default(10).describe("每页数量，默认 10")
});
export type QueryArticleAiAnalysisHistoryParams = z.infer<typeof QueryArticleAiAnalysisHistoryParamsSchema>;

export interface ArticleAiAnalysis {
	id: string;
	sourceId: string;
	analysisType: GetArticleAiAnalysisParams["analysisType"];
	sourceTitle?: string;
	market?: string;
	sessionId: string;
	status: string;
	content: string;
	createdAt: string;
	updatedAt: string;
}
