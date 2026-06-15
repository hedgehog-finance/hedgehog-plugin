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
export const SyncStockBasicParamsSchema = z.object({
    stocks: z.array(StockBasicItemSchema).min(1)
});
export const GetStockBasicListParamsSchema = z.object({}).nullish();
export const GetStockBasicInfoParamsSchema = z.object({
    stock_code: z.string().trim().min(1).describe("股票代码")
});
export const GetStockBasicInfoAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    required: ["stock_code"],
    properties: {
        stock_code: { type: "string", description: "股票代码，例如：000001.SZ 或 600000.SH" }
    }
};
//# sourceMappingURL=schema.js.map