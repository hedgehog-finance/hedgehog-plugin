import { z } from "openclaw/plugin-sdk/zod";
export declare const AddProfileLibraryParamsSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
}, z.core.$strip>;
export type AddProfileLibraryParams = z.infer<typeof AddProfileLibraryParamsSchema>;
export declare const DeleteProfileLibraryParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export type DeleteProfileLibraryParams = z.infer<typeof DeleteProfileLibraryParamsSchema>;
export declare const GetProfileLibraryByIdParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export type GetProfileLibraryByIdParams = z.infer<typeof GetProfileLibraryByIdParamsSchema>;
export declare const QueryProfileLibrariesParamsSchema: z.ZodObject<{
    keyword: z.ZodOptional<z.ZodString>;
    page: z.ZodOptional<z.ZodNumber>;
    pageSize: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type QueryProfileLibrariesParams = z.infer<typeof QueryProfileLibrariesParamsSchema>;
export declare const GetProfileLibrariesParamsSchema: z.ZodObject<{
    page: z.ZodOptional<z.ZodNumber>;
    pageSize: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type GetProfileLibrariesParams = z.infer<typeof GetProfileLibrariesParamsSchema>;
export interface ProfileLibraryRow {
    id: string;
    title: string;
}
