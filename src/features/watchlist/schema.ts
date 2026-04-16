import { z } from "zod";

const ExchangeEnum = z.enum(["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]);
const MarketEnum = z.enum(["A_SHARE", "US_SHARE", "HK_SHARE", "FUTURES", "FUND", "OTHER"]);

export const AddToWatchlistParamsSchema = z.object({
	stockCode: z.string(),
	stockName: z.string(),
	exchange: ExchangeEnum,
	market: MarketEnum,
	groupIds: z.array(z.string()).optional()
});

export type AddToWatchlistParams = z.infer<typeof AddToWatchlistParamsSchema>;

export const UpdateWatchlistItemSchema = z.object({
	id: z.string(),
	stockName: z.string().optional(),
	sortOrder: z.number().optional(),
	groupIds: z.array(z.string()).optional()
});
export type UpdateWatchlistItemParams = z.infer<typeof UpdateWatchlistItemSchema>;

export const CreateWatchlistGroupSchema = z.object({
	name: z.string()
});
export type CreateWatchlistGroupParams = z.infer<typeof CreateWatchlistGroupSchema>;

export const UpdateWatchlistGroupSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	sortOrder: z.number().optional()
});
export type UpdateWatchlistGroupParams = z.infer<typeof UpdateWatchlistGroupSchema>;
