import { getDB } from "../../core/database.js";
import { RuntimeTool, StockAiAnalysis } from "./schema.js";
export declare function normalizeStockCode(stock_code: string): string;
export declare function saveStockAiAnalysisRecord(db: ReturnType<typeof getDB>, args: {
    stock_code: string;
    stock_name?: string;
    market: string;
    sessionId?: string;
    content: string;
    status?: string;
}): StockAiAnalysis;
export declare const stockAnalysisTools: Record<string, RuntimeTool>;
