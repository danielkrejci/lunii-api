import z from "zod";

export const errorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

/**
 * A zod schema in the shape Gemini accepts as `responseJsonSchema`.
 *
 * `$schema` and `additionalProperties` are stripped: the API takes only a subset of
 * JSON Schema, and neither keyword constrains a decoder that can emit nothing but the
 * properties it was handed.
 */
export function toResponseJsonSchema(schema: z.ZodType): Record<string, unknown> {
    return stripUnsupportedKeywords(z.toJSONSchema(schema, { io: "output" })) as Record<string, unknown>;
}

function stripUnsupportedKeywords(node: unknown): unknown {
    if (Array.isArray(node)) {
        return node.map((item) => stripUnsupportedKeywords(item));
    }

    if (node && typeof node === "object") {
        return Object.fromEntries(
            Object.entries(node)
                .filter(([key]) => key !== "$schema" && key !== "additionalProperties")
                .map(([key, value]) => [key, stripUnsupportedKeywords(value)])
        );
    }

    return node;
}
