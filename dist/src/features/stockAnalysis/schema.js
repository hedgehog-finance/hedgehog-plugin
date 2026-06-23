import { z } from "zod";
export const BuildStockAiAnalysisMessageParamsSchema = z.object({
    stock_code: z.string().trim().min(1).describe("股票代码"),
    stock_name: z.string().trim().min(1).describe("股票名称"),
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
    sessionId: z.string().trim().optional().default("").describe("前端生成的会话 ID")
});
export const BuildStockAiAnalysisMessageAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    required: ["stock_code", "stock_name"],
    properties: {
        stock_code: { type: "string", description: "股票代码" },
        stock_name: { type: "string", description: "股票名称" },
        market: { type: "string", description: "市场类型，默认 CN" },
        sessionId: { type: "string", description: "前端生成的会话 ID" }
    }
};
export const GetStockAiAnalysisParamsSchema = z.object({
    stock_code: z.string().trim().min(1).describe("股票代码"),
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN")
});
export const GetStockAiAnalysisDetailParamsSchema = z.object({
    id: z.string().trim().min(1).describe("分析记录 ID")
});
export const GetStockAiAnalysisDetailBySessionParamsSchema = z.object({
    sessionId: z.string().trim().min(1).describe("前端生成的会话 ID"),
    stock_code: z.string().trim().min(1).describe("股票代码")
});
export const QueryStockAiAnalysisHistoryParamsSchema = z.object({
    stock_code: z.string().trim().min(1).optional().describe("股票代码，不传则查询全部"),
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
    page: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(50).default(10).describe("每页数量，默认 10")
});
export const QueryStockAiAnalysisStocksParamsSchema = z.object({
    market: z.string().trim().min(1).default("CN").describe("市场类型，默认 CN"),
    page: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(100).default(50).describe("每页数量，默认 50")
});
export const ArticleAiAnalysisKindSchema = z.enum(["verification", "deduction"]);
export const GetArticleAiAnalysisParamsSchema = z.object({
    sourceId: z.string().trim().min(1).describe("文章来源 ID，例如 news-5、report-5、announce-5"),
    analysisType: ArticleAiAnalysisKindSchema.describe("分析类型：verification 信息求证，deduction 深度推演"),
    market: z.string().trim().min(1).default("CN").describe("市场类型；深度推演使用，信息求证忽略")
});
export const QueryArticleAiAnalysisHistoryParamsSchema = z.object({
    analysisType: ArticleAiAnalysisKindSchema.describe("分析类型：verification 信息求证，deduction 深度推演"),
    market: z.string().trim().min(1).default("CN").describe("市场类型；深度推演使用，信息求证忽略"),
    page: z.number().int().min(1).default(1).describe("页码"),
    pageSize: z.number().int().min(1).max(50).default(10).describe("每页数量，默认 10")
});
//# sourceMappingURL=schema.js.map