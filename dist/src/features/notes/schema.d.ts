import { z } from "zod";
export declare const AddStockNoteParamsSchema: z.ZodEffects<z.ZodObject<{
    watchlistId: z.ZodOptional<z.ZodString>;
    stock_code: z.ZodOptional<z.ZodString>;
    exchange: z.ZodOptional<z.ZodEnum<["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]>>;
    note: z.ZodString;
    profileLibraryIds: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        title: string;
        id: string;
    }, {
        title: string;
        id: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    note: string;
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    profileLibraryIds?: {
        title: string;
        id: string;
    }[] | undefined;
}, {
    note: string;
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    profileLibraryIds?: {
        title: string;
        id: string;
    }[] | undefined;
}>, {
    note: string;
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    profileLibraryIds?: {
        title: string;
        id: string;
    }[] | undefined;
}, {
    note: string;
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    profileLibraryIds?: {
        title: string;
        id: string;
    }[] | undefined;
}>;
export type AddStockNoteParams = z.infer<typeof AddStockNoteParamsSchema>;
export declare const DeleteStockNoteParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
}, {
    id: string;
}>;
export type DeleteStockNoteParams = z.infer<typeof DeleteStockNoteParamsSchema>;
export declare const UpdateStockNoteParamsSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodString;
    watchlistId: z.ZodOptional<z.ZodString>;
    stock_code: z.ZodOptional<z.ZodString>;
    exchange: z.ZodOptional<z.ZodEnum<["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]>>;
    note: z.ZodOptional<z.ZodString>;
    profileLibraryIds: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        title: string;
        id: string;
    }, {
        title: string;
        id: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    note?: string | undefined;
    profileLibraryIds?: {
        title: string;
        id: string;
    }[] | undefined;
}, {
    id: string;
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    note?: string | undefined;
    profileLibraryIds?: {
        title: string;
        id: string;
    }[] | undefined;
}>, {
    id: string;
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    note?: string | undefined;
    profileLibraryIds?: {
        title: string;
        id: string;
    }[] | undefined;
}, {
    id: string;
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    note?: string | undefined;
    profileLibraryIds?: {
        title: string;
        id: string;
    }[] | undefined;
}>;
export type UpdateStockNoteParams = z.infer<typeof UpdateStockNoteParamsSchema>;
export declare const GetStockNoteByIdParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
}, {
    id: string;
}>;
export type GetStockNoteByIdParams = z.infer<typeof GetStockNoteByIdParamsSchema>;
export declare const QueryStockNotesParamsSchema: z.ZodObject<{
    watchlistId: z.ZodOptional<z.ZodString>;
    stock_code: z.ZodOptional<z.ZodString>;
    exchange: z.ZodOptional<z.ZodEnum<["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]>>;
    keyword: z.ZodOptional<z.ZodString>;
    page: z.ZodOptional<z.ZodNumber>;
    pageSize: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    keyword?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
}, {
    stock_code?: string | undefined;
    watchlistId?: string | undefined;
    exchange?: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX" | undefined;
    keyword?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
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
export declare const GetStockNoteParamsSchema: z.ZodObject<{
    stock_code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    stock_code: string;
}, {
    stock_code: string;
}>;
export type GetStockNoteParams = z.infer<typeof GetStockNoteParamsSchema>;
export declare const GetStockNoteAgentToolSchema: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        stock_code: {
            type: string;
            description: string;
        };
    };
};
export interface WatchlistStock {
    id: string;
    stock_code: string;
    stock_name: string;
    exchange: string;
    market: string;
}
export interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx: {
        userId: string;
    }): Promise<string>;
}
