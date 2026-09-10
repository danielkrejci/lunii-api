import z from "zod";

export const errorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        /**
         * Suppresses the client's automatic Alert, so the app can answer with something
         * better than a system dialog.
         *
         * Declared here rather than only where it is set, because the zod serializer
         * strips anything a response schema does not mention — a `silent` set in a
         * handler but missing from the schema never reaches the app at all. The rate
         * limiter gets away with it only because `errorResponseBuilder` bypasses
         * serialization entirely.
         */
        silent: z.boolean().optional(),
    }),
});

/**
 * What a reader may do with something that costs credits, answered alongside the thing
 * itself.
 *
 * Carried by every response that can be bought, so the client never has to hold two
 * queries in agreement — the screen's own fetch already knows whether it is unlocked,
 * what it costs, and whether it can be afforded.
 */
export const accessSchema = z.object({
    unlocked: z.boolean(),
    /** An active subscription. Nothing is counted and nothing is spent. */
    unlimited: z.boolean(),
    cost: z.number().int(),
    /** Null while unlimited: there is no balance to speak of. */
    balance: z.number().int().nullable(),
    affordable: z.boolean(),
});

/**
 * The 402 body: everything a paywall needs, without a second request.
 *
 * `silent` is a literal rather than optional here — this error must never reach the
 * client's generic Alert, and making it non-optional is what stops a handler forgetting.
 */
export const insufficientCreditsSchema = z.object({
    error: z.object({
        code: z.literal("insufficient_credits"),
        message: z.string(),
        silent: z.literal(true),
        details: z.object({
            /** What the reader was trying to buy, so the paywall can say so. */
            feature: z.string(),
            cost: z.number().int(),
            balance: z.number().int(),
            nextCreditAt: z.string().nullable(),
        }),
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
