import { z } from "zod";
export const GetPluginVersionParamsSchema = z.object({}).nullish();
export const GetOpenClawVersionInfoParamsSchema = z.object({}).nullish();
export const GetSkillVersionsParamsSchema = z.object({}).nullish();
function parseJsonString(value) {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
const SkillVersionsRecordSchema = z.preprocess(parseJsonString, z.record(z.string()));
const SkillVersionsArraySchema = z.preprocess(parseJsonString, z.array(z.object({
    name: z.string(),
    version: z.string()
})));
export const UpdateSkillVersionsParamsSchema = z.preprocess(parseJsonString, z.object({
    versions: SkillVersionsRecordSchema.optional(),
    skills: SkillVersionsArraySchema.optional()
})).refine(params => Boolean(params.versions || params.skills), {
    message: "versions or skills is required"
});
export const UpdateSkillVersionsAgentToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        versions: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "skill 版本映射，key 为 skill 名称，value 为版本号"
        },
        skills: {
            type: "array",
            description: "skill 版本列表",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "version"],
                properties: {
                    name: { type: "string", description: "skill 名称" },
                    version: { type: "string", description: "skill 版本号" }
                }
            }
        }
    }
};
export const BuildUpdateSkillVersionsMessageParamsSchema = UpdateSkillVersionsParamsSchema;
//# sourceMappingURL=schema.js.map