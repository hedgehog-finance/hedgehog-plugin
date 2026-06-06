import { z } from "zod";

export const AddProfileLibraryParamsSchema = z.object({
	id: z.string().trim().min(1).optional().describe("资料库 ID，不传则自动生成"),
	title: z.string().trim().min(1).describe("资料库标题")
});
export type AddProfileLibraryParams = z.infer<typeof AddProfileLibraryParamsSchema>;

export const DeleteProfileLibraryParamsSchema = z.object({
	id: z.string().trim().min(1).describe("资料库 ID")
});
export type DeleteProfileLibraryParams = z.infer<typeof DeleteProfileLibraryParamsSchema>;

export const GetProfileLibraryByIdParamsSchema = z.object({
	id: z.string().trim().min(1).describe("资料库 ID")
});
export type GetProfileLibraryByIdParams = z.infer<typeof GetProfileLibraryByIdParamsSchema>;

export const QueryProfileLibrariesParamsSchema = z.object({
	keyword: z.string().trim().optional().describe("模糊查询关键词，可匹配标题或 ID"),
	page: z.number().int().min(1).optional().describe("页码，从 1 开始，默认 1"),
	pageSize: z.number().int().min(1).max(100).optional().describe("每页数量，默认 20，最大 100")
});
export type QueryProfileLibrariesParams = z.infer<typeof QueryProfileLibrariesParamsSchema>;

export const GetProfileLibrariesParamsSchema = z.object({
	page: z.number().int().min(1).optional().describe("页码，从 1 开始，默认 1"),
	pageSize: z.number().int().min(1).max(100).optional().describe("每页数量，默认 20，最大 100")
});
export type GetProfileLibrariesParams = z.infer<typeof GetProfileLibrariesParamsSchema>;

export interface ProfileLibraryRow {
	id: string;
	title: string;
}
