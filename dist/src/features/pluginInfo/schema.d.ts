import { z } from "zod";
export declare const GetPluginVersionParamsSchema: z.ZodOptional<z.ZodNullable<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>>>;
export declare const GetSkillVersionsParamsSchema: z.ZodOptional<z.ZodNullable<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>>>;
export declare const UpdateSkillVersionsParamsSchema: z.ZodEffects<z.ZodObject<{
    versions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    skills: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}>, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}>;
export type UpdateSkillVersionsParams = z.infer<typeof UpdateSkillVersionsParamsSchema>;
export declare const BuildUpdateSkillVersionsMessageParamsSchema: z.ZodEffects<z.ZodObject<{
    versions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    skills: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}>, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}>;
export type BuildUpdateSkillVersionsMessageParams = z.infer<typeof BuildUpdateSkillVersionsMessageParamsSchema>;
