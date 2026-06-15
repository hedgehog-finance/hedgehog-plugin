import { z } from "zod";
export declare const AddProfileLibraryParamsSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
}, "strip", z.ZodTypeAny, {
    title: string;
    id?: string | undefined;
}, {
    title: string;
    id?: string | undefined;
}>;
export type AddProfileLibraryParams = z.infer<typeof AddProfileLibraryParamsSchema>;
export declare const DeleteProfileLibraryParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
}, {
    id: string;
}>;
export type DeleteProfileLibraryParams = z.infer<typeof DeleteProfileLibraryParamsSchema>;
export declare const GetProfileLibraryByIdParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
}, {
    id: string;
}>;
export type GetProfileLibraryByIdParams = z.infer<typeof GetProfileLibraryByIdParamsSchema>;
export declare const QueryProfileLibrariesParamsSchema: z.ZodObject<{
    keyword: z.ZodOptional<z.ZodString>;
    page: z.ZodOptional<z.ZodNumber>;
    pageSize: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    keyword?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
}, {
    keyword?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type QueryProfileLibrariesParams = z.infer<typeof QueryProfileLibrariesParamsSchema>;
export declare const GetProfileLibrariesParamsSchema: z.ZodObject<{
    page: z.ZodOptional<z.ZodNumber>;
    pageSize: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page?: number | undefined;
    pageSize?: number | undefined;
}, {
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export type GetProfileLibrariesParams = z.infer<typeof GetProfileLibrariesParamsSchema>;
export interface ProfileLibraryRow {
    id: string;
    title: string;
}
export interface RuntimeTool {
    name: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    execute(params: unknown, ctx: {
        userId: string;
    }): Promise<string>;
}
