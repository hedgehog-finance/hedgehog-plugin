import { PluginRuntime } from "openclaw/plugin-sdk";
import { StockClassification } from "../../types.js";
declare function normalizeStockCodeForCache(stock_code: string, exchange?: string): string;
export declare const watchlistLogic: {
    _normalizeStockCodeForCache: typeof normalizeStockCodeForCache;
    getStockClassification(rt: PluginRuntime, stock_name: string, stock_code: string, exchange: string, _userId: string): Promise<StockClassification | null>;
    classifyStocksTogether(rt: PluginRuntime, stocks: any[], _userId: string): Promise<StockClassification[]>;
    getBatchStockClassification(rt: PluginRuntime, stocks: any[], _userId: string, options?: {
        requireComplete?: boolean;
        forceRefresh?: boolean;
    }): Promise<(StockClassification | null)[]>;
    _getKnownCategories(db: any): {
        industries: any[];
        themes: any[];
    };
    _autoClassifyWithAI(rt: PluginRuntime, stock_name: string, stock_code: string, exchange: string): Promise<StockClassification | null>;
    _callClassifierCompletion(rt: PluginRuntime, sessionId: string, prompt: string, timeoutMs: number): Promise<string>;
    _callClassifierAi(rt: PluginRuntime, sessionId: string, prompt: string, timeoutMs: number): Promise<string>;
    _ensureCategory(db: any, name: string, type: "industry" | "theme", userId: string): string;
    _buildSmartSortPrompt(stocks: {
        name: string;
        code: string;
    }[]): string;
    applySmartSort(rt: PluginRuntime, sessionId: string, stocks: {
        name: string;
        code: string;
    }[]): Promise<any[]>;
    _parseClassification(raw: any, cats: {
        industries: string[];
        themes: string[];
    }, label: string): StockClassification;
    _normalizeCachedClassification(value: StockClassification): StockClassification;
    _buildAiPrompt(industries: string[], themes: string[], input: string, isBatch: boolean): string;
    _anchorToCategory(value: string, categories: string[]): string;
};
export {};
