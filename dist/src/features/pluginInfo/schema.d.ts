import { z } from "zod";
export declare const GetPluginVersionParamsSchema: z.ZodOptional<z.ZodNullable<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>>>;
export declare const GetOpenClawVersionInfoParamsSchema: z.ZodOptional<z.ZodNullable<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>>>;
export declare const GetSkillVersionsParamsSchema: z.ZodOptional<z.ZodNullable<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>>>;
export declare const UpdateSkillVersionsParamsSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    versions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodString>, Record<string, string>, unknown>>;
    skills: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>, "many">, {
        name: string;
        version: string;
    }[], unknown>>;
}, "strip", z.ZodTypeAny, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, {
    versions?: unknown;
    skills?: unknown;
}>, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, unknown>, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, unknown>;
export type UpdateSkillVersionsParams = z.infer<typeof UpdateSkillVersionsParamsSchema>;
export declare const UpdateSkillVersionsAgentToolSchema: {
    type: string;
    additionalProperties: boolean;
    properties: {
        versions: {
            type: string;
            additionalProperties: {
                type: string;
            };
            description: string;
        };
        skills: {
            type: string;
            description: string;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    name: {
                        type: string;
                        description: string;
                    };
                    version: {
                        type: string;
                        description: string;
                    };
                };
            };
        };
    };
};
export declare const BuildUpdateSkillVersionsMessageParamsSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    versions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodString>, Record<string, string>, unknown>>;
    skills: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>, "many">, {
        name: string;
        version: string;
    }[], unknown>>;
}, "strip", z.ZodTypeAny, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, {
    versions?: unknown;
    skills?: unknown;
}>, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, unknown>, {
    versions?: Record<string, string> | undefined;
    skills?: {
        name: string;
        version: string;
    }[] | undefined;
}, unknown>;
export type BuildUpdateSkillVersionsMessageParams = z.infer<typeof BuildUpdateSkillVersionsMessageParamsSchema>;
export interface RuntimeTool {
    name: string;
    description: string;
    parameters: unknown;
    registerTool?: boolean;
    agentToolTarget?: "main";
    execute(params: unknown, ctx: {
        userId: string;
    }): Promise<string>;
}
