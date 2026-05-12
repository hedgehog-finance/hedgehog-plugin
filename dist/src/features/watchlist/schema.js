import { z } from "openclaw/plugin-sdk/zod";
export const GetWatchlistParamsSchema = z.object({
    categoryId: z.string().optional().describe("分类 ID，不传返回所有"),
    categoryType: z.enum(["industry", "theme"]).optional().describe("分类类型")
});
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
    stockCode: z.string(),
    stockName: z.string(),
    exchange: ExchangeEnum,
    market: MarketEnum
});
export const BatchAddToWatchlistParamsSchema = z.object({
    stocks: z.array(AddToWatchlistParamsSchema)
});
export const UpdateWatchlistItemSchema = z.object({
    id: z.string(),
    stockName: z.string().optional(),
    sortOrder: z.number().optional()
});
//# sourceMappingURL=schema.js.map