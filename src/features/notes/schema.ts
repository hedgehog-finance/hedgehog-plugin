import { z } from "openclaw/plugin-sdk/zod";

const ExchangeEnum = z.enum(["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]);
const ProfileLibraryInputSchema = z.object({
	id: z.string().trim().min(1).describe("资料库 ID"),
	title: z.string().trim().min(1).describe("资料库标题")
});

export const AddStockNoteParamsSchema = z.object({
	watchlistId: z.string().trim().min(1).optional().describe("自选股 ID，优先使用该字段绑定股票"),
	stock_code: z.string().trim().min(1).optional().describe("股票代码；未传 watchlistId 时需与 exchange 一起定位股票"),
	exchange: ExchangeEnum.optional().describe("交易所；未传 watchlistId 时需与 stock_code 一起定位股票"),
	note: z.string().trim().min(1).max(200).describe("笔记内容，200 字以内"),
	profileLibraryIds: z.array(ProfileLibraryInputSchema).optional().describe("关联资料库列表，格式为 { id, title }")
}).refine((value) => Boolean(value.watchlistId || (value.stock_code && value.exchange)), {
	message: "watchlistId 或 stock_code + exchange 必须传一个"
});
export type AddStockNoteParams = z.infer<typeof AddStockNoteParamsSchema>;

export const DeleteStockNoteParamsSchema = z.object({
	id: z.string().trim().min(1).describe("笔记 ID")
});
export type DeleteStockNoteParams = z.infer<typeof DeleteStockNoteParamsSchema>;

export const UpdateStockNoteParamsSchema = z.object({
	id: z.string().trim().min(1).describe("笔记 ID"),
	watchlistId: z.string().trim().min(1).optional().describe("自选股 ID；传入则重新绑定股票"),
	stock_code: z.string().trim().min(1).optional().describe("股票代码；与 exchange 一起传入可重新绑定股票"),
	exchange: ExchangeEnum.optional().describe("交易所；与 stock_code 一起传入可重新绑定股票"),
	note: z.string().trim().min(1).max(200).optional().describe("笔记内容，200 字以内"),
	profileLibraryIds: z.array(ProfileLibraryInputSchema).optional().describe("关联资料库列表，格式为 { id, title }；传入则覆盖原有关联")
}).refine((value) => !(value.stock_code && !value.exchange) && !(!value.stock_code && value.exchange), {
	message: "stock_code 与 exchange 必须同时传入"
});
export type UpdateStockNoteParams = z.infer<typeof UpdateStockNoteParamsSchema>;

export const GetStockNoteByIdParamsSchema = z.object({
	id: z.string().trim().min(1).describe("笔记 ID")
});
export type GetStockNoteByIdParams = z.infer<typeof GetStockNoteByIdParamsSchema>;

export const QueryStockNotesParamsSchema = z.object({
	watchlistId: z.string().trim().min(1).optional().describe("自选股 ID"),
	stock_code: z.string().trim().min(1).optional().describe("股票代码"),
	exchange: ExchangeEnum.optional().describe("交易所"),
	keyword: z.string().trim().optional().describe("模糊查询关键词，可匹配股票代码、股票名称或笔记内容"),
	page: z.number().int().min(1).optional().describe("页码，从 1 开始，默认 1"),
	pageSize: z.number().int().min(1).max(100).optional().describe("每页数量，默认 20，最大 100")
});
export type QueryStockNotesParams = z.infer<typeof QueryStockNotesParamsSchema>;

export interface StockNoteRow {
	id: string;
	watchlistId: string;
	stock_code: string;
	stock_name: string;
	exchange: string;
	market: string;
	note: string;
	createdAt: string;
	updatedAt: string;
}

export interface StockNoteProfileLibraryRow {
	noteId: string;
	id: string;
	title: string;
}

export interface StockNote extends StockNoteRow {
	profileLibraries: {
		id: string;
		title: string;
	}[];
}
