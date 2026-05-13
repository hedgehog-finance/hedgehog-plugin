import { z } from "zod";
export const StockClassificationSchema = z.object({
    industry: z.object({
        name: z.string(),
        weight: z.number().min(0).max(100).default(50)
    }).describe("Required main industry category with weight"),
    theme: z.array(z.object({
        name: z.string(),
        weight: z.number().min(0).max(100).default(50)
    })).describe("Thematic categories with weights"),
    weight: z.number().min(0).max(100).default(50).describe("Overall priority weight")
});
//# sourceMappingURL=types.js.map