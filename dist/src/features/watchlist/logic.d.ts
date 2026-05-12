import { PluginRuntime } from "openclaw/plugin-sdk";
import { StockClassification } from "../../types.js";
declare function normalizeStockCodeForCache(stockCode: string, exchange?: string): string;
/**
 * 智能分类元数据引擎
 */
export declare const watchlistLogic: {
    _normalizeStockCodeForCache: typeof normalizeStockCodeForCache;
    /**
     * 获取单只股票的分类与权重（带全局缓存）
     */
    getStockClassification(rt: PluginRuntime, stockName: string, stockCode: string, exchange: string, _userId: string): Promise<StockClassification | null>;
    /**
     * 批量获取股票分类
     */
    classifyStocksTogether(rt: PluginRuntime, stocks: any[], _userId: string): Promise<StockClassification[]>;
    getBatchStockClassification(rt: PluginRuntime, stocks: any[], _userId: string, options?: {
        requireComplete?: boolean;
        forceRefresh?: boolean;
    }): Promise<(StockClassification | null)[]>;
    _getKnownCategories(db: any): {
        industries: any[];
        themes: any[];
    };
    /**
     * 内部 AI 实现 (适配新协议)
     */
    _autoClassifyWithAI(rt: PluginRuntime, stockName: string, stockCode: string, exchange: string): Promise<StockClassification | null>;
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
