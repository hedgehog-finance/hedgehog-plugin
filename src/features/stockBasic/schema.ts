import { z } from "zod";

export const StockBasicItemSchema = z.object({
	act_ent_type: z.string().optional().default(""),
	act_name: z.string().optional().default(""),
	area: z.string().optional().default(""),
	cnspell: z.string().optional().default(""),
	curr_type: z.string().optional().default(""),
	enname: z.string().optional().default(""),
	exchange: z.string().trim().min(1),
	fullname: z.string().optional().default(""),
	industry: z.string().optional().default(""),
	is_hs: z.string().optional().default(""),
	list_date: z.string().optional().default(""),
	market: z.string().optional().default(""),
	name: z.string().trim().min(1),
	stock_code: z.string().trim().min(1),
	symbol: z.string().trim().min(1)
});
export type StockBasicItem = z.infer<typeof StockBasicItemSchema>;

export const SyncStockBasicParamsSchema = z.object({
	stocks: z.array(StockBasicItemSchema).min(1)
});
export type SyncStockBasicParams = z.infer<typeof SyncStockBasicParamsSchema>;

export const GetStockBasicListParamsSchema = z.object({}).nullish();
export type GetStockBasicListParams = z.infer<typeof GetStockBasicListParamsSchema>;

export const GetStockBasicInfoParamsSchema = z.object({
	stock_code: z.string().trim().min(1).describe("股票代码")
});
export type GetStockBasicInfoParams = z.infer<typeof GetStockBasicInfoParamsSchema>;
