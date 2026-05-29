import { z } from "openclaw/plugin-sdk/zod";
export const GetStockAiAnalysisParamsSchema = z.object({
    stockCode: z.string().trim().min(1).describe("股票代码"),
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN")
});
export const QueryStockAiAnalysisHistoryParamsSchema = z.object({
    stockCode: z.string().trim().min(1).describe("股票代码"),
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
    page: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(50).default(20).describe("每页数量")
});
export const SaveStockAiAnalysisParamsSchema = z.object({
    stockCode: z.string().trim().min(1).describe("股票代码"),
    stockName: z.string().trim().min(1).describe("股票名称"),
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
    content: z.string().trim().min(1).describe("AI 分析内容")
});
export const ArticleAiAnalysisKindSchema = z.enum(["verification", "deduction"]);
export const GetArticleAiAnalysisParamsSchema = z.object({
    id: z.string().trim().min(1).describe("文章来源 ID，例如 news-5、report-5、announce-5"),
    analysisType: ArticleAiAnalysisKindSchema.describe("分析类型：verification 信息求证，deduction 深度推演"),
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN")
});
export const SaveArticleAiAnalysisParamsSchema = z.object({
    id: z.string().trim().min(1).describe("文章来源 ID，例如 news-5、report-5、announce-5"),
    analysisType: ArticleAiAnalysisKindSchema.describe("分析类型：verification 信息求证，deduction 深度推演"),
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
    content: z.string().trim().min(1).describe("AI 分析内容")
});
//# sourceMappingURL=schema.js.map