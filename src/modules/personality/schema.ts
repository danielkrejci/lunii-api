import { z } from "zod";

import { SINGS_MAP, ZodiacSign } from "../../utils/natalUtils";
import {
    Element,
    ELEMENTS,
    KEY_PLANET_CANDIDATES,
    KeyPlanet,
    MODALITIES,
    Modality,
    NATAL_POINTS,
    NatalPoint,
} from "../astro";

/**
 * The two things the personality generation produces, and the shapes they are stored in.
 *
 * Shared by the generation, by `profile/add` (which receives both back from the client,
 * because onboarding writes them before a profile exists) and by the reader block that
 * carries the context into every other prompt. One definition, so the three cannot drift.
 *
 * The caps are what make the client round-trip safe: whatever comes back is at most the
 * size a real generation could have produced.
 */

const signSchema = z.enum(SINGS_MAP as [ZodiacSign, ...ZodiacSign[]]);
const pointSchema = z.enum(NATAL_POINTS as [NatalPoint, ...NatalPoint[]]);

/* ============================================================
   COSMIC OVERVIEW — what the reader sees
============================================================ */

const placementCardSchema = z.object({
    sign: signSchema,
    /** One to three words for the compact card. Empty when the generation failed. */
    keyword: z.string().max(80),
    /** One sentence for the expanded card. */
    text: z.string().max(400),
});

const distribution = <K extends string>(keys: readonly K[]) =>
    z.object(Object.fromEntries(keys.map((key) => [key, z.number().min(0)])) as Record<K, z.ZodNumber>);

/**
 * The profile screen, as stored in `profile.personality_profile`.
 *
 * Facts and words side by side: every sign, element, modality and planet here was
 * computed from the chart, and only `keyword`, `text` and `summary` were written
 * by the model. Names, symbols, the area a planet stands for and the constellation are
 * the client's own static copy, keyed by these values.
 */
export const personalityOverviewSchema = z.object({
    sun: placementCardSchema,
    moon: placementCardSchema,
    /** Null without a birth time — the Ascendant would be a guess. */
    rising: placementCardSchema.nullable(),
    element: z.object({
        key: z.enum(ELEMENTS as [Element, ...Element[]]),
        distribution: distribution(ELEMENTS),
        text: z.string().max(400),
    }),
    modality: z.object({
        key: z.enum(MODALITIES as [Modality, ...Modality[]]),
        distribution: distribution(MODALITIES),
        text: z.string().max(400),
    }),
    keyPlanets: z
        .array(
            z.object({
                planet: z.enum(KEY_PLANET_CANDIDATES as [KeyPlanet, ...KeyPlanet[]]),
                sign: signSchema,
                retrograde: z.boolean(),
                text: z.string().max(400),
            })
        )
        .max(3),
    signature: z.object({
        /** Two or three paragraphs, one per entry. */
        summary: z.array(z.string().max(1000)).max(3),
    }),
});

export type PersonalityOverview = z.infer<typeof personalityOverviewSchema>;

/* ============================================================
   PERSONALITY CONTEXT — what every other prompt reads
============================================================ */

/** At most this many observations per category, and the model may return none. */
export const CONTEXT_ITEMS_PER_CATEGORY = 3;

/**
 * The categories, in the order they are written and read.
 *
 * No "personal context" category on purpose: interests and life situation already reach
 * every prompt as the raw facts the reader picked, and a paraphrase of them frozen at
 * signup only goes stale.
 */
export const CONTEXT_CATEGORIES = [
    "corePatterns",
    "innerTensions",
    "emotionalPatterns",
    "relationshipPatterns",
    "workPatterns",
] as const;

export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

export const contextItemSchema = z.object({
    /** Behaviour, in plain words. Never names a sign, a planet or an aspect. */
    text: z.string().min(1).max(600),
    /**
     * The chart points the observation stands on. Never shown to the model that reads it
     * later — it is what lets the Moon screen take the items about the Moon, and the
     * daily horoscope the items about whatever today is touching.
     */
    points: z.array(pointSchema).max(4),
});

export type ContextItem = z.infer<typeof contextItemSchema>;

export const personalityContextSchema = z.object(
    Object.fromEntries(
        CONTEXT_CATEGORIES.map((category) => [category, z.array(contextItemSchema).max(CONTEXT_ITEMS_PER_CATEGORY)])
    ) as Record<ContextCategory, z.ZodArray<typeof contextItemSchema>>
);

export type PersonalityContext = z.infer<typeof personalityContextSchema>;
