import { z } from "zod";
export declare const GetWatchlistParamsSchema: z.ZodObject<{
    categoryId: z.ZodOptional<z.ZodString>;
    categoryType: z.ZodOptional<z.ZodEnum<["industry", "theme"]>>;
}, "strip", z.ZodTypeAny, {
    categoryId?: string | undefined;
    categoryType?: "industry" | "theme" | undefined;
}, {
    categoryId?: string | undefined;
    categoryType?: "industry" | "theme" | undefined;
}>;
export type GetWatchlistParams = z.infer<typeof GetWatchlistParamsSchema>;
export declare const GetWatchlistAgentToolSchema: {
    type: string;
    additionalProperties: boolean;
    properties: {
        categoryId: {
            type: string;
            description: string;
        };
        categoryType: {
            type: string;
            enum: string[];
            description: string;
        };
    };
};
export declare const SyncCategoriesParamsSchema: z.ZodObject<{
    industries: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    themes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    industries?: string[] | undefined;
    themes?: string[] | undefined;
}, {
    industries?: string[] | undefined;
    themes?: string[] | undefined;
}>;
export type SyncCategoriesParams = z.infer<typeof SyncCategoriesParamsSchema>;
export declare const BatchUpdateSortOrdersParamsSchema: z.ZodObject<{
    orderedIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    orderedIds: string[];
}, {
    orderedIds: string[];
}>;
export type BatchUpdateSortOrdersParams = z.infer<typeof BatchUpdateSortOrdersParamsSchema>;
export declare const AddToWatchlistParamsSchema: z.ZodObject<{
    stock_code: z.ZodString;
    stock_name: z.ZodString;
    exchange: z.ZodEnum<["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]>;
    market: z.ZodEnum<["A_SHARE", "US_SHARE", "HK_SHARE", "FUTURES", "FUND", "OTHER"]>;
}, "strip", z.ZodTypeAny, {
    stock_code: string;
    stock_name: string;
    exchange: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX";
    market: "A_SHARE" | "US_SHARE" | "HK_SHARE" | "FUTURES" | "FUND" | "OTHER";
}, {
    stock_code: string;
    stock_name: string;
    exchange: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX";
    market: "A_SHARE" | "US_SHARE" | "HK_SHARE" | "FUTURES" | "FUND" | "OTHER";
}>;
export type AddToWatchlistParams = z.infer<typeof AddToWatchlistParamsSchema>;
export declare const BatchAddToWatchlistParamsSchema: z.ZodObject<{
    stocks: z.ZodArray<z.ZodObject<{
        stock_code: z.ZodString;
        stock_name: z.ZodString;
        exchange: z.ZodEnum<["SSE", "SZSE", "NASDAQ", "NYSE", "AMEX", "HKEX"]>;
        market: z.ZodEnum<["A_SHARE", "US_SHARE", "HK_SHARE", "FUTURES", "FUND", "OTHER"]>;
    }, "strip", z.ZodTypeAny, {
        stock_code: string;
        stock_name: string;
        exchange: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX";
        market: "A_SHARE" | "US_SHARE" | "HK_SHARE" | "FUTURES" | "FUND" | "OTHER";
    }, {
        stock_code: string;
        stock_name: string;
        exchange: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX";
        market: "A_SHARE" | "US_SHARE" | "HK_SHARE" | "FUTURES" | "FUND" | "OTHER";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    stocks: {
        stock_code: string;
        stock_name: string;
        exchange: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX";
        market: "A_SHARE" | "US_SHARE" | "HK_SHARE" | "FUTURES" | "FUND" | "OTHER";
    }[];
}, {
    stocks: {
        stock_code: string;
        stock_name: string;
        exchange: "SSE" | "SZSE" | "HKEX" | "NASDAQ" | "NYSE" | "AMEX";
        market: "A_SHARE" | "US_SHARE" | "HK_SHARE" | "FUTURES" | "FUND" | "OTHER";
    }[];
}>;
export type BatchAddToWatchlistParams = z.infer<typeof BatchAddToWatchlistParamsSchema>;
export declare const UpdateWatchlistItemSchema: z.ZodObject<{
    id: z.ZodString;
    stock_name: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    id: string;
    stock_name?: string | undefined;
    sortOrder?: number | undefined;
}, {
    id: string;
    stock_name?: string | undefined;
    sortOrder?: number | undefined;
}>;
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
export declare const GetIndustryListParamsSchema: z.ZodObject<{
    type: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type?: string | undefined;
}, {
    type?: string | undefined;
}>;
export type GetIndustryListParams = z.infer<typeof GetIndustryListParamsSchema>;
export declare const GetIndustryListAgentToolSchema: {
    type: string;
    additionalProperties: boolean;
    properties: {
        type: {
            type: string;
            enum: string[];
            description: string;
        };
    };
};
