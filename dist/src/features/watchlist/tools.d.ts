import { z } from "zod";
import { PluginRuntime } from "openclaw/plugin-sdk";
import { AddToWatchlistParams, GetWatchlistParams, SyncCategoriesParams, BatchUpdateSortOrdersParams, GetIndustryListParams } from "./schema.js";
export declare const watchlistTools: {
    add_to_watchlist: {
        name: string;
        description: string;
        parameters: z.ZodObject<{
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
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>;
        registerTool: boolean;
        execute: (args: {
            id: string;
        }, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    get_watchlist: {
        name: string;
        label: string;
        description: string;
        parameters: {
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
        registerTool: boolean;
        execute: (rawArgs?: GetWatchlistParams, ctx?: {
            userId: string;
        }) => Promise<string>;
    };
    get_industry_list: {
        name: string;
        label: string;
        description: string;
        parameters: {
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
        registerTool: boolean;
        execute: (rawArgs?: GetIndustryListParams) => Promise<string>;
    };
    get_thematic_dashboard: {
        name: string;
        description: string;
        parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        registerTool: boolean;
        execute: (_args: {}, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    get_watchlist_tabs: {
        name: string;
        description: string;
        parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        registerTool: boolean;
        execute: (_args: {}, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    smart_reorder_watchlist: {
        name: string;
        description: string;
        parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
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
            industries: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            themes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            industries?: string[] | undefined;
            themes?: string[] | undefined;
        }, {
            industries?: string[] | undefined;
            themes?: string[] | undefined;
        }>;
        registerTool: boolean;
        execute: (args: SyncCategoriesParams, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    batch_update_sort_orders: {
        name: string;
        description: string;
        parameters: z.ZodObject<{
            orderedIds: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            orderedIds: string[];
        }, {
            orderedIds: string[];
        }>;
        registerTool: boolean;
        execute: (args: BatchUpdateSortOrdersParams, ctx: {
            userId: string;
        }) => Promise<string>;
    };
    reset_watchlist_classification: {
        name: string;
        description: string;
        parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        registerTool: boolean;
        execute: (_args: {}, ctx: {
            userId: string;
            runtime?: PluginRuntime;
        }) => Promise<string>;
    };
};
