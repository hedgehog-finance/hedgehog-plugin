import { z } from "openclaw/plugin-sdk/zod";
export declare const GetWatchlistParamsSchema: z.ZodObject<{
    categoryId: z.ZodOptional<z.ZodString>;
    categoryType: z.ZodOptional<z.ZodEnum<{
        industry: "industry";
        theme: "theme";
    }>>;
}, z.core.$strip>;
export type GetWatchlistParams = z.infer<typeof GetWatchlistParamsSchema>;
export declare const SyncCategoriesParamsSchema: z.ZodObject<{
    industries: z.ZodOptional<z.ZodArray<z.ZodString>>;
    themes: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type SyncCategoriesParams = z.infer<typeof SyncCategoriesParamsSchema>;
export declare const BatchUpdateSortOrdersParamsSchema: z.ZodObject<{
    orderedIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type BatchUpdateSortOrdersParams = z.infer<typeof BatchUpdateSortOrdersParamsSchema>;
export declare const AddToWatchlistParamsSchema: z.ZodObject<{
    stock_code: z.ZodString;
    stock_name: z.ZodString;
    exchange: z.ZodEnum<{
        SSE: "SSE";
        SZSE: "SZSE";
        HKEX: "HKEX";
        NASDAQ: "NASDAQ";
        NYSE: "NYSE";
        AMEX: "AMEX";
    }>;
    market: z.ZodEnum<{
        A_SHARE: "A_SHARE";
        US_SHARE: "US_SHARE";
        HK_SHARE: "HK_SHARE";
        FUTURES: "FUTURES";
        FUND: "FUND";
        OTHER: "OTHER";
    }>;
}, z.core.$strip>;
export type AddToWatchlistParams = z.infer<typeof AddToWatchlistParamsSchema>;
export declare const BatchAddToWatchlistParamsSchema: z.ZodObject<{
    stocks: z.ZodArray<z.ZodObject<{
        stock_code: z.ZodString;
        stock_name: z.ZodString;
        exchange: z.ZodEnum<{
            SSE: "SSE";
            SZSE: "SZSE";
            HKEX: "HKEX";
            NASDAQ: "NASDAQ";
            NYSE: "NYSE";
            AMEX: "AMEX";
        }>;
        market: z.ZodEnum<{
            A_SHARE: "A_SHARE";
            US_SHARE: "US_SHARE";
            HK_SHARE: "HK_SHARE";
            FUTURES: "FUTURES";
            FUND: "FUND";
            OTHER: "OTHER";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type BatchAddToWatchlistParams = z.infer<typeof BatchAddToWatchlistParamsSchema>;
export declare const UpdateWatchlistItemSchema: z.ZodObject<{
    id: z.ZodString;
    stock_name: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
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
