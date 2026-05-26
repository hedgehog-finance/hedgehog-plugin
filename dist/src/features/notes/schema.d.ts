import { z } from "openclaw/plugin-sdk/zod";
export declare const AddStockNoteParamsSchema: z.ZodObject<{
    watchlistId: z.ZodOptional<z.ZodString>;
    stockCode: z.ZodOptional<z.ZodString>;
    exchange: z.ZodOptional<z.ZodEnum<{
        SSE: "SSE";
        SZSE: "SZSE";
        HKEX: "HKEX";
        NASDAQ: "NASDAQ";
        NYSE: "NYSE";
        AMEX: "AMEX";
    }>>;
    note: z.ZodString;
    profileLibraryIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type AddStockNoteParams = z.infer<typeof AddStockNoteParamsSchema>;
export declare const DeleteStockNoteParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export type DeleteStockNoteParams = z.infer<typeof DeleteStockNoteParamsSchema>;
export declare const UpdateStockNoteParamsSchema: z.ZodObject<{
    id: z.ZodString;
    watchlistId: z.ZodOptional<z.ZodString>;
    stockCode: z.ZodOptional<z.ZodString>;
    exchange: z.ZodOptional<z.ZodEnum<{
        SSE: "SSE";
        SZSE: "SZSE";
        HKEX: "HKEX";
        NASDAQ: "NASDAQ";
        NYSE: "NYSE";
        AMEX: "AMEX";
    }>>;
    note: z.ZodOptional<z.ZodString>;
    profileLibraryIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type UpdateStockNoteParams = z.infer<typeof UpdateStockNoteParamsSchema>;
export declare const GetStockNoteByIdParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export type GetStockNoteByIdParams = z.infer<typeof GetStockNoteByIdParamsSchema>;
export declare const QueryStockNotesParamsSchema: z.ZodObject<{
    watchlistId: z.ZodOptional<z.ZodString>;
    stockCode: z.ZodOptional<z.ZodString>;
    exchange: z.ZodOptional<z.ZodEnum<{
        SSE: "SSE";
        SZSE: "SZSE";
        HKEX: "HKEX";
        NASDAQ: "NASDAQ";
        NYSE: "NYSE";
        AMEX: "AMEX";
    }>>;
    keyword: z.ZodOptional<z.ZodString>;
    page: z.ZodOptional<z.ZodNumber>;
    pageSize: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type QueryStockNotesParams = z.infer<typeof QueryStockNotesParamsSchema>;
export interface StockNoteRow {
    id: string;
    watchlistId: string;
    stockCode: string;
    stockName: string;
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
