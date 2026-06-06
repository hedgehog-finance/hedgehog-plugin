import { z } from "zod";

export const GetPluginVersionParamsSchema = z.object({}).nullish();

export const GetSkillVersionsParamsSchema = z.object({}).nullish();

export const UpdateSkillVersionsParamsSchema = z.object({
	versions: z.record(z.string()).optional(),
	skills: z.array(z.object({
		name: z.string(),
		version: z.string()
	})).optional()
}).refine(params => Boolean(params.versions || params.skills), {
	message: "versions or skills is required"
});
export type UpdateSkillVersionsParams = z.infer<typeof UpdateSkillVersionsParamsSchema>;

export const BuildUpdateSkillVersionsMessageParamsSchema = UpdateSkillVersionsParamsSchema;
export type BuildUpdateSkillVersionsMessageParams = z.infer<typeof BuildUpdateSkillVersionsMessageParamsSchema>;
