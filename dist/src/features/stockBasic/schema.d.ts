import { z } from "zod";
export declare const StockBasicItemSchema: z.ZodObject<{
    act_ent_type: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    act_name: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    area: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    cnspell: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    curr_type: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    enname: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    exchange: z.ZodString;
    fullname: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    industry: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    is_hs: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    list_date: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    market: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    name: z.ZodString;
    stock_code: z.ZodString;
    symbol: z.ZodString;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    name: string;
    stock_code: string;
    industry: string;
    market: string;
    exchange: string;
    act_ent_type: string;
    act_name: string;
    area: string;
    cnspell: string;
    curr_type: string;
    enname: string;
    fullname: string;
    is_hs: string;
    list_date: string;
}, {
    symbol: string;
    name: string;
    stock_code: string;
    exchange: string;
    industry?: string | undefined;
    market?: string | undefined;
    act_ent_type?: string | undefined;
    act_name?: string | undefined;
    area?: string | undefined;
    cnspell?: string | undefined;
    curr_type?: string | undefined;
    enname?: string | undefined;
    fullname?: string | undefined;
    is_hs?: string | undefined;
    list_date?: string | undefined;
}>;
export type StockBasicItem = z.infer<typeof StockBasicItemSchema>;
export declare const SyncStockBasicParamsSchema: z.ZodObject<{
    stocks: z.ZodArray<z.ZodObject<{
        act_ent_type: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        act_name: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        area: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        cnspell: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        curr_type: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        enname: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        exchange: z.ZodString;
        fullname: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        industry: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        is_hs: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        list_date: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        market: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        name: z.ZodString;
        stock_code: z.ZodString;
        symbol: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        name: string;
        stock_code: string;
        industry: string;
        market: string;
        exchange: string;
        act_ent_type: string;
        act_name: string;
        area: string;
        cnspell: string;
        curr_type: string;
        enname: string;
        fullname: string;
        is_hs: string;
        list_date: string;
    }, {
        symbol: string;
        name: string;
        stock_code: string;
        exchange: string;
        industry?: string | undefined;
        market?: string | undefined;
        act_ent_type?: string | undefined;
        act_name?: string | undefined;
        area?: string | undefined;
        cnspell?: string | undefined;
        curr_type?: string | undefined;
        enname?: string | undefined;
        fullname?: string | undefined;
        is_hs?: string | undefined;
        list_date?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    stocks: {
        symbol: string;
        name: string;
        stock_code: string;
        industry: string;
        market: string;
        exchange: string;
        act_ent_type: string;
        act_name: string;
        area: string;
        cnspell: string;
        curr_type: string;
        enname: string;
        fullname: string;
        is_hs: string;
        list_date: string;
    }[];
}, {
    stocks: {
        symbol: string;
        name: string;
        stock_code: string;
        exchange: string;
        industry?: string | undefined;
        market?: string | undefined;
        act_ent_type?: string | undefined;
        act_name?: string | undefined;
        area?: string | undefined;
        cnspell?: string | undefined;
        curr_type?: string | undefined;
        enname?: string | undefined;
        fullname?: string | undefined;
        is_hs?: string | undefined;
        list_date?: string | undefined;
    }[];
}>;
export type SyncStockBasicParams = z.infer<typeof SyncStockBasicParamsSchema>;
export declare const GetStockBasicListParamsSchema: z.ZodOptional<z.ZodNullable<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>>>;
export type GetStockBasicListParams = z.infer<typeof GetStockBasicListParamsSchema>;
export declare const GetStockBasicInfoParamsSchema: z.ZodObject<{
    stock_code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    stock_code: string;
}, {
    stock_code: string;
}>;
export type GetStockBasicInfoParams = z.infer<typeof GetStockBasicInfoParamsSchema>;
export declare const GetStockBasicInfoAgentToolSchema: {
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
export interface RuntimeTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx?: {
        userId: string;
    }): Promise<string>;
}
