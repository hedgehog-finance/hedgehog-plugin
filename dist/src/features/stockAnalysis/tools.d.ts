import { getDB } from "../../core/database.js";
import { StockAiAnalysis } from "./schema.js";
interface RuntimeTool {
    name: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx: {
        userId: string;
    }): Promise<string>;
}
export declare function normalizeStockCode(stock_code: string): string;
export declare function saveStockAiAnalysisRecord(db: ReturnType<typeof getDB>, userId: string, args: {
    stock_code: string;
    stock_name: string;
    market: string;
    content: string;
}): StockAiAnalysis;
export declare const stockAnalysisTools: Record<string, RuntimeTool>;
export {};
