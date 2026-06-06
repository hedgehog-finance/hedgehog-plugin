import { z } from "zod";
export declare const AiAnalysisStatusSchema: z.ZodEnum<["generating", "completed", "failed"]>;
export declare const BuildStockAiAnalysisMessageParamsSchema: z.ZodObject<{
    stock_code: z.ZodString;
    stock_name: z.ZodString;
    market: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    stock_code: string;
    stock_name: string;
    market: string;
}, {
    stock_code: string;
    stock_name: string;
    market?: string | undefined;
}>;
export type BuildStockAiAnalysisMessageParams = z.infer<typeof BuildStockAiAnalysisMessageParamsSchema>;
export declare const GetStockAiAnalysisParamsSchema: z.ZodObject<{
    stock_code: z.ZodString;
    market: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    stock_code: string;
    market: string;
}, {
    stock_code: string;
    market?: string | undefined;
}>;
export type GetStockAiAnalysisParams = z.infer<typeof GetStockAiAnalysisParamsSchema>;
export declare const GetStockAiAnalysisDetailParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
}, {
    id: string;
}>;
export type GetStockAiAnalysisDetailParams = z.infer<typeof GetStockAiAnalysisDetailParamsSchema>;
export declare const QueryStockAiAnalysisHistoryParamsSchema: z.ZodObject<{
    stock_code: z.ZodOptional<z.ZodString>;
    market: z.ZodDefault<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    market: string;
    page: number;
    pageSize: number;
    stock_code?: string | undefined;
}, {
    stock_code?: string | undefined;
    market?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type QueryStockAiAnalysisHistoryParams = z.infer<typeof QueryStockAiAnalysisHistoryParamsSchema>;
export declare const QueryStockAiAnalysisStocksParamsSchema: z.ZodObject<{
    market: z.ZodDefault<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    market: string;
    page: number;
    pageSize: number;
}, {
    market?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type QueryStockAiAnalysisStocksParams = z.infer<typeof QueryStockAiAnalysisStocksParamsSchema>;
export declare const SaveStockAiAnalysisParamsSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    stock_code: z.ZodString;
    stock_name: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    market: z.ZodDefault<z.ZodString>;
    content: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["generating", "completed", "failed"]>>;
}, "strict", z.ZodTypeAny, {
    stock_code: string;
    stock_name: string;
    market: string;
    status: "generating" | "completed" | "failed";
    content: string;
}, {
    stock_code: string;
    stock_name?: string | undefined;
    market?: string | undefined;
    status?: "generating" | "completed" | "failed" | undefined;
    content?: string | undefined;
}>, {
    stock_code: string;
    stock_name: string;
    market: string;
    status: "generating" | "completed" | "failed";
    content: string;
}, {
    stock_code: string;
    stock_name?: string | undefined;
    market?: string | undefined;
    status?: "generating" | "completed" | "failed" | undefined;
    content?: string | undefined;
}>, {
    stock_code: string;
    stock_name: string;
    market: string;
    status: "generating" | "completed" | "failed";
    content: string;
}, {
    stock_code: string;
    stock_name?: string | undefined;
    market?: string | undefined;
    status?: "generating" | "completed" | "failed" | undefined;
    content?: string | undefined;
}>;
export type SaveStockAiAnalysisParams = z.infer<typeof SaveStockAiAnalysisParamsSchema>;
export interface StockAiAnalysis {
    id: string;
    stock_code: string;
    stock_name: string;
    market: string;
    status: string;
    content: string;
    createdAt: string;
    updatedAt: string;
}
export interface StockAiAnalysisStockSummary {
    stock_code: string;
    stock_name: string;
    market: string;
    latestAnalysisId: string;
    latestStatus: string;
    latestCreatedAt: string;
    latestUpdatedAt: string;
    analysisCount: number;
}
export declare const ArticleAiAnalysisKindSchema: z.ZodEnum<["verification", "deduction"]>;
export declare const GetArticleAiAnalysisParamsSchema: z.ZodObject<{
    sourceId: z.ZodString;
    analysisType: z.ZodEnum<["verification", "deduction"]>;
    market: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    market: string;
    sourceId: string;
    analysisType: "verification" | "deduction";
}, {
    sourceId: string;
    analysisType: "verification" | "deduction";
    market?: string | undefined;
}>;
export type GetArticleAiAnalysisParams = z.infer<typeof GetArticleAiAnalysisParamsSchema>;
export declare const QueryArticleAiAnalysisHistoryParamsSchema: z.ZodObject<{
    analysisType: z.ZodEnum<["verification", "deduction"]>;
    market: z.ZodDefault<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    market: string;
    page: number;
    pageSize: number;
    analysisType: "verification" | "deduction";
}, {
    analysisType: "verification" | "deduction";
    market?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type QueryArticleAiAnalysisHistoryParams = z.infer<typeof QueryArticleAiAnalysisHistoryParamsSchema>;
export declare const SaveArticleAiAnalysisParamsSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    sourceId: z.ZodString;
    sourceTitle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    content: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["generating", "completed", "failed"]>>;
}, "strict", z.ZodTypeAny, {
    status: "generating" | "completed" | "failed";
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    status?: "generating" | "completed" | "failed" | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>, {
    status: "generating" | "completed" | "failed";
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    status?: "generating" | "completed" | "failed" | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>, {
    status: "generating" | "completed" | "failed";
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    status?: "generating" | "completed" | "failed" | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>;
export type SaveArticleAiAnalysisParams = z.infer<typeof SaveArticleAiAnalysisParamsSchema>;
export declare const SaveArticleDeepReasoningParamsSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    sourceId: z.ZodString;
    sourceTitle: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    market: z.ZodDefault<z.ZodString>;
    content: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["generating", "completed", "failed"]>>;
}, "strict", z.ZodTypeAny, {
    market: string;
    status: "generating" | "completed" | "failed";
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    market?: string | undefined;
    status?: "generating" | "completed" | "failed" | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>, {
    market: string;
    status: "generating" | "completed" | "failed";
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    market?: string | undefined;
    status?: "generating" | "completed" | "failed" | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>, {
    market: string;
    status: "generating" | "completed" | "failed";
    sourceId: string;
    sourceTitle: string;
    content: string;
}, {
    sourceId: string;
    market?: string | undefined;
    status?: "generating" | "completed" | "failed" | undefined;
    sourceTitle?: string | undefined;
    content?: string | undefined;
}>;
export type SaveArticleDeepReasoningParams = z.infer<typeof SaveArticleDeepReasoningParamsSchema>;
export interface ArticleAiAnalysis {
    id: string;
    sourceId: string;
    analysisType: GetArticleAiAnalysisParams["analysisType"];
    sourceTitle?: string;
    market?: string;
    status: string;
    content: string;
    createdAt: string;
    updatedAt: string;
}
