import { z } from "openclaw/plugin-sdk/zod";
const ExchangeEnum = z.enum(["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]);
export const AddStockNoteParamsSchema = z.object({
    watchlistId: z.string().trim().min(1).optional().describe("自选股 ID，优先使用该字段绑定股票"),
    stockCode: z.string().trim().min(1).optional().describe("股票代码；未传 watchlistId 时需与 exchange 一起定位股票"),
    exchange: ExchangeEnum.optional().describe("交易所；未传 watchlistId 时需与 stockCode 一起定位股票"),
    note: z.string().trim().min(1).max(200).describe("笔记内容，200 字以内"),
    profileLibraryIds: z.array(z.string().trim().min(1)).optional().describe("关联资料库 ID 列表")
}).refine((value) => Boolean(value.watchlistId || (value.stockCode && value.exchange)), {
    message: "watchlistId 或 stockCode + exchange 必须传一个"
});
export const DeleteStockNoteParamsSchema = z.object({
    id: z.string().trim().min(1).describe("笔记 ID")
});
export const UpdateStockNoteParamsSchema = z.object({
    id: z.string().trim().min(1).describe("笔记 ID"),
    watchlistId: z.string().trim().min(1).optional().describe("自选股 ID；传入则重新绑定股票"),
    stockCode: z.string().trim().min(1).optional().describe("股票代码；与 exchange 一起传入可重新绑定股票"),
    exchange: ExchangeEnum.optional().describe("交易所；与 stockCode 一起传入可重新绑定股票"),
    note: z.string().trim().min(1).max(200).optional().describe("笔记内容，200 字以内"),
    profileLibraryIds: z.array(z.string().trim().min(1)).optional().describe("关联资料库 ID 列表；传入则覆盖原有关联")
}).refine((value) => !(value.stockCode && !value.exchange) && !(!value.stockCode && value.exchange), {
    message: "stockCode 与 exchange 必须同时传入"
});
export const GetStockNoteByIdParamsSchema = z.object({
    id: z.string().trim().min(1).describe("笔记 ID")
});
export const QueryStockNotesParamsSchema = z.object({
    watchlistId: z.string().trim().min(1).optional().describe("自选股 ID"),
    stockCode: z.string().trim().min(1).optional().describe("股票代码"),
    exchange: ExchangeEnum.optional().describe("交易所"),
    keyword: z.string().trim().optional().describe("模糊查询关键词，可匹配股票代码、股票名称或笔记内容"),
    page: z.number().int().min(1).optional().describe("页码，从 1 开始，默认 1"),
    pageSize: z.number().int().min(1).max(100).optional().describe("每页数量，默认 20，最大 100")
});
//# sourceMappingURL=schema.js.map