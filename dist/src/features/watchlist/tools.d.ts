import { z } from "openclaw/plugin-sdk/zod";
import { PluginRuntime } from "openclaw/plugin-sdk";
import { AddToWatchlistParams, GetWatchlistParams, SyncCategoriesParams, BatchUpdateSortOrdersParams } from "./schema.js";
export declare const watchlistTools: {
    add_to_watchlist: {
        name: string;
        description: string;
        parameters: z.ZodObject<{
            stockCode: z.ZodString;
            stockName: z.ZodString;
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
        registerTool: boolean;
        execute: (args: AddToWatchlistParams, ctx: {
            userId: string;
            runtime?: PluginRuntime;
        }) => Promise<string>;
    };
    batch_add_to_watchlist: {
        name: string;
        description: string;
        parameters: z.ZodObject<{
            stocks: z.ZodArray<z.ZodObject<{
                stockCode: z.ZodString;
                stockName: z.ZodString;
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
        registerTool: boolean;
        execute: (args: {
            stocks: AddToWatchlistParams[];
        }, ctx: {
            userId: string;
            runtime?: PluginRuntime;
        }) => Promise<string>;
    };
    remove_from_watchlist: {
        name: string;
        description: string;
        parameters: z.ZodObject<{
            id: z.ZodString;
        }, z.core.$strip>;
        registerTool: boolean;
        execute: (args: {
            id: string;
        }, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    get_watchlist: {
        name: string;
        description: string;
        parameters: z.ZodObject<{
            categoryId: z.ZodOptional<z.ZodString>;
            categoryType: z.ZodOptional<z.ZodEnum<{
                industry: "industry";
                theme: "theme";
            }>>;
        }, z.core.$strip>;
        registerTool: boolean;
        execute: (args: GetWatchlistParams, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    get_thematic_dashboard: {
        name: string;
        description: string;
        parameters: z.ZodObject<{}, z.core.$strip>;
        registerTool: boolean;
        execute: (_args: {}, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    get_watchlist_tabs: {
        name: string;
        description: string;
        parameters: z.ZodObject<{}, z.core.$strip>;
        registerTool: boolean;
        execute: (_args: {}, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    smart_reorder_watchlist: {
        name: string;
        description: string;
        parameters: z.ZodObject<{}, z.core.$strip>;
        registerTool: boolean;
        execute: (_args: {}, ctx: {
            userId: string;
            runtime?: PluginRuntime;
        }) => Promise<string>;
    };
    sync_watchlist_categories: {
        name: string;
        description: string;
        parameters: z.ZodObject<{
            industries: z.ZodOptional<z.ZodArray<z.ZodString>>;
            themes: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        registerTool: boolean;
        execute: (args: SyncCategoriesParams, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    batch_update_sort_orders: {
        name: string;
        description: string;
        parameters: z.ZodObject<{
            orderedIds: z.ZodArray<z.ZodString>;
        }, z.core.$strip>;
        registerTool: boolean;
        execute: (args: BatchUpdateSortOrdersParams, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    reset_watchlist_classification: {
        name: string;
        description: string;
        parameters: z.ZodObject<{}, z.core.$strip>;
        registerTool: boolean;
        execute: (_args: {}, ctx: {
            userId: string;
            runtime?: PluginRuntime;
        }) => Promise<string>;
    };
};
