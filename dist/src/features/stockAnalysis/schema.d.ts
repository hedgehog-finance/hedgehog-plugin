import { z } from "openclaw/plugin-sdk/zod";
export declare const GetStockAiAnalysisParamsSchema: z.ZodObject<{
    stock_code: z.ZodString;
    market: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type GetStockAiAnalysisParams = z.infer<typeof GetStockAiAnalysisParamsSchema>;
export declare const QueryStockAiAnalysisHistoryParamsSchema: z.ZodObject<{
    stock_code: z.ZodString;
    market: z.ZodDefault<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type QueryStockAiAnalysisHistoryParams = z.infer<typeof QueryStockAiAnalysisHistoryParamsSchema>;
export declare const SaveStockAiAnalysisParamsSchema: z.ZodObject<{
    stock_code: z.ZodString;
    stock_name: z.ZodString;
    market: z.ZodDefault<z.ZodString>;
    content: z.ZodString;
}, z.core.$strip>;
export type SaveStockAiAnalysisParams = z.infer<typeof SaveStockAiAnalysisParamsSchema>;
export interface StockAiAnalysis {
    id: string;
    stock_code: string;
    stock_name: string;
    market: string;
    content: string;
    createdAt: string;
    updatedAt: string;
}
export declare const ArticleAiAnalysisKindSchema: z.ZodEnum<{
    verification: "verification";
    deduction: "deduction";
}>;
export declare const GetArticleAiAnalysisParamsSchema: z.ZodObject<{
    id: z.ZodString;
    analysisType: z.ZodEnum<{
        verification: "verification";
        deduction: "deduction";
    }>;
    market: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type GetArticleAiAnalysisParams = z.infer<typeof GetArticleAiAnalysisParamsSchema>;
export declare const SaveArticleAiAnalysisParamsSchema: z.ZodObject<{
    id: z.ZodString;
    analysisType: z.ZodEnum<{
        verification: "verification";
        deduction: "deduction";
    }>;
    market: z.ZodDefault<z.ZodString>;
    content: z.ZodString;
}, z.core.$strip>;
export type SaveArticleAiAnalysisParams = z.infer<typeof SaveArticleAiAnalysisParamsSchema>;
export interface ArticleAiAnalysis {
    id: string;
    sourceId: string;
    analysisType: GetArticleAiAnalysisParams["analysisType"];
    market: string;
    content: string;
    createdAt: string;
    updatedAt: string;
}
