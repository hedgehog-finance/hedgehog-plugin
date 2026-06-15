import { z } from "zod";
export const GetWatchlistParamsSchema = z.object({
    categoryId: z.string().optional().describe("分类 ID，不传返回所有"),
    categoryType: z.enum(["industry", "theme"]).optional().describe("分类类型")
});
export const GetWatchlistAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        categoryId: { type: "string", description: "分类 ID，不传返回所有" },
        categoryType: { type: "string", enum: ["industry", "theme"], description: "分类类型" }
    }
};
export const SyncCategoriesParamsSchema = z.object({
    industries: z.array(z.string()).optional(),
    themes: z.array(z.string()).optional()
});
export const BatchUpdateSortOrdersParamsSchema = z.object({
    orderedIds: z.array(z.string())
});
const ExchangeEnum = z.enum(["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]);
const MarketEnum = z.enum(["A_SHARE", "US_SHARE", "HK_SHARE", "FUTURES", "FUND", "OTHER"]);
export const AddToWatchlistParamsSchema = z.object({
    stock_code: z.string(),
    stock_name: z.string(),
    exchange: ExchangeEnum,
    market: MarketEnum
});
export const BatchAddToWatchlistParamsSchema = z.object({
    stocks: z.array(AddToWatchlistParamsSchema)
});
export const UpdateWatchlistItemSchema = z.object({
    id: z.string(),
    stock_name: z.string().optional(),
    sortOrder: z.number().optional()
});
export const GetIndustryListParamsSchema = z.object({
    type: z.string().optional().describe("分类类型：industry 行业，theme 主题，空字符串或不传表示全部")
});
export const GetIndustryListAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        type: { type: "string", enum: ["industry", "theme", ""], description: "分类类型：industry 行业，theme 主题，空字符串或不传表示全部" }
    }
};
//# sourceMappingURL=schema.js.map