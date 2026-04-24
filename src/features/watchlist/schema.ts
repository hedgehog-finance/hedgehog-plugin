import { z } from "openclaw/plugin-sdk/zod";

const ExchangeEnum = z.enum(["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]);
const MarketEnum = z.enum(["A_SHARE", "US_SHARE", "HK_SHARE", "FUTURES", "FUND", "OTHER"]);

export const AddToWatchlistParamsSchema = z.object({
	stockCode: z.string(),
	stockName: z.string(),
	exchange: ExchangeEnum,
	market: MarketEnum,
	// 支持：1. 字符串 "白酒" 2. 数组 ["白酒"] 3. 带权重的对象 { name: "白酒", weight: 99 }
	industry: z.union([z.string(), z.array(z.string()), z.any()]).optional(),
	theme: z.union([z.string(), z.array(z.string()), z.any()]).optional()
});

export type AddToWatchlistParams = z.infer<typeof AddToWatchlistParamsSchema>;

export const BatchAddToWatchlistParamsSchema = z.object({
	stocks: z.array(AddToWatchlistParamsSchema)
});

export type BatchAddToWatchlistParams = z.infer<typeof BatchAddToWatchlistParamsSchema>;

export const UpdateWatchlistItemSchema = z.object({
	id: z.string(),
	stockName: z.string().optional(),
	sortOrder: z.number().optional()
});
export type UpdateWatchlistItemParams = z.infer<typeof UpdateWatchlistItemSchema>;
