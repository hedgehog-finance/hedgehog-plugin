import { z } from "zod";

export const GetWatchlistParamsSchema = z.object({
	categoryId: z.string().optional().describe("分类 ID，不传返回所有"),
	categoryType: z.enum(["industry", "theme"]).optional().describe("分类类型")
});
export type GetWatchlistParams = z.infer<typeof GetWatchlistParamsSchema>;

export const SyncCategoriesParamsSchema = z.object({
	industries: z.array(z.string()).optional(),
	themes: z.array(z.string()).optional()
});
export type SyncCategoriesParams = z.infer<typeof SyncCategoriesParamsSchema>;

export const BatchUpdateSortOrdersParamsSchema = z.object({
	orderedIds: z.array(z.string())
});
export type BatchUpdateSortOrdersParams = z.infer<typeof BatchUpdateSortOrdersParamsSchema>;

const ExchangeEnum = z.enum(["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]);
const MarketEnum = z.enum(["A_SHARE", "US_SHARE", "HK_SHARE", "FUTURES", "FUND", "OTHER"]);

export const AddToWatchlistParamsSchema = z.object({
	stock_code: z.string(),
	stock_name: z.string(),
	exchange: ExchangeEnum,
	market: MarketEnum
});

export type AddToWatchlistParams = z.infer<typeof AddToWatchlistParamsSchema>;

export const BatchAddToWatchlistParamsSchema = z.object({
	stocks: z.array(AddToWatchlistParamsSchema)
});

export type BatchAddToWatchlistParams = z.infer<typeof BatchAddToWatchlistParamsSchema>;

export const UpdateWatchlistItemSchema = z.object({
	id: z.string(),
	stock_name: z.string().optional(),
	sortOrder: z.number().optional()
});
export type UpdateWatchlistItemParams = z.infer<typeof UpdateWatchlistItemSchema>;

export interface WatchlistRow {
	id: string;
	stock_code: string;
	stock_name: string;
	exchange: string;
	market?: string;
	userId: string;
	sortOrder: number;
	isDeleted: number;
	createdAt: string;
}

export interface CategoryRow {
	id: string;
	name: string;
	type?: 'industry' | 'theme';
	weight?: number;
}

export const GetIndustryListParamsSchema = z.object({
	type: z.string().optional().describe("分类类型：industry 行业，theme 主题，空字符串或不传表示全部")
});
export type GetIndustryListParams = z.infer<typeof GetIndustryListParamsSchema>;
