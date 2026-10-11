import { Gender } from "../../utils/natalUtils";
import { humanizeEnum, humanizeEnums } from "../../utils/stringUtils";
import { NatalChart, NatalPoint, PERSONAL_POINTS } from "../astro";
import { CONTEXT_CATEGORIES, ContextCategory, personalityContextSchema } from "../personality/schema";

/**
 * The reader, as every prompt sees them.
 *
 * Structural rather than the stored row: `db/schema` imports this module for its content
 * types, so importing the table back would close a cycle. The whole profile row satisfies
 * it, which is the same arrangement `ScoringProfile` uses in modules/dailyScore/service.
 */
export interface Reader {
    /** Decides the gendered forms in languages that inflect for the addressee. */
    gender: Gender;
    decisionStyle: string;
    careerStage: string;
    relationshipStatus: string;
    areasOfInterest: string[];
    beliefLevel: string;
    contentPreference: string;
    /**
     * The private analysis written with the profile. Typed loosely on purpose: it is
     * read back from JSONB, and from onboarding it came through the client.
     */
    personalityContext: unknown;
    birthChart: NatalChart;
}

/**
 * Anything that names a natal point today is landing on.
 *
 * Structural so both halves of the engine fit: `Impact` carries the aspects the horoscope
 * is written from, `PlanetContact` the ones a panel displays, and this only ever needs
 * the point itself.
 */
export interface TouchedPoint {
    natal: NatalPoint;
}

/**
 * What each kind of prompt takes from the personality context.
 *
 * Not the whole context: a prompt carries what bears on its own question, and every
 * observation that does not is one more thing for the model to work in where it has no
 * business. `points` pulls in observations about one body from any category — the Moon
 * screen wants what the context says about the Moon, wherever it filed it.
 *
 * The limit keeps the block a description of the reader rather than a second prompt.
 * Chat's is higher: it is cached once per conversation and has to answer anything.
 */
const FOCUS: Record<ReaderFocus, { categories: ContextCategory[]; points?: NatalPoint[]; limit: number }> = {
    daily: { categories: ["corePatterns", "innerTensions"], limit: 6 },
    planet: { categories: ["corePatterns"], limit: 5 },
    moon: { categories: ["emotionalPatterns"], points: ["moon"], limit: 5 },
    compatibility: { categories: ["relationshipPatterns", "innerTensions"], limit: 6 },
    chat: { categories: ["corePatterns", "innerTensions", "emotionalPatterns", "relationshipPatterns"], limit: 8 },
};

/**
 * Which prompt the block is for, and therefore which part of the context it carries.
 */
export type ReaderFocus = "daily" | "planet" | "moon" | "compatibility" | "chat";

/**
 * The observations a prompt should carry, most relevant first.
 *
 * Observations about a point today is touching come first — they are the reason the
 * reader's personality matters to this particular text — then the focus's own categories.
 * The order is otherwise fixed by `CONTEXT_CATEGORIES`, so the same reader on the same
 * question yields the same block: chat caches it.
 *
 * An empty array covers every case where there is nothing usable — a failed generation,
 * a row written before the context existed, anything that does not parse — and the
 * caller drops the block entirely. A block that says "not available" is worse than none.
 */
function selectContext(stored: unknown, focus: ReaderFocus, touched: NatalPoint[]): string[] {
    const parsed = personalityContextSchema.safeParse(stored);

    if (!parsed.success) {
        return [];
    }

    const { categories, points = [], limit } = FOCUS[focus];
    const wanted = new Set([...points, ...touched]);
    const all = CONTEXT_CATEGORIES.flatMap((category) => parsed.data[category].map((item) => ({ category, item })));

    const selected = [
        ...all.filter(({ item }) => item.points.some((point) => wanted.has(point))),
        ...all.filter(({ category }) => categories.includes(category)),
    ].map(({ item }) => item.text.trim());

    return [...new Set(selected)].filter(Boolean).slice(0, limit);
}

/**
 * How many placements the block names. Four rather than however many today happens to
 * touch: past that it stops reading as "what today is landing on" and becomes the chart.
 */
const TOUCHED_PLACEMENT_LIMIT = 4;

/**
 * The natal points today is actually touching, with their signs.
 *
 * Only personal points, and only the strongest few. Uranus, Neptune and Pluto sit in the
 * same sign for years, so "their Uranus in Capricorn" describes a birth cohort rather
 * than a reader — the aspect to it may well be personal, but naming its sign invites the
 * model to write about the generation instead of the person.
 */
function describeTouchedPlacements(birthChart: NatalChart, contacts: TouchedPoint[]): string[] {
    const seen = new Set<NatalPoint>();
    const lines: string[] = [];

    for (const contact of contacts) {
        if (seen.has(contact.natal) || !PERSONAL_POINTS.includes(contact.natal)) {
            continue;
        }

        if (lines.length >= TOUCHED_PLACEMENT_LIMIT) {
            break;
        }

        seen.add(contact.natal);

        const placement = birthChart[contact.natal];

        // Absent only for the Ascendant of a reader with no birth time.
        if (placement) {
            lines.push(`- their ${contact.natal} in ${placement.sign}`);
        }
    }

    return lines;
}

/**
 * The one description of the reader that every prompt shares.
 *
 * Written once rather than per prompt on purpose: the horoscope, the Moon screen and the
 * compatibility overview are all addressed to the same person on the same day, and three
 * separately worded versions of who that person is drift into three different products.
 *
 * Every line is omitted when it is empty rather than filled with "none" or "unknown" —
 * telling a model there is nothing personal about this reader is worse than not raising
 * the subject.
 */
export function buildReaderBlock(reader: Reader, focus: ReaderFocus, contacts: TouchedPoint[] = []): string {
    const facts: string[] = [];

    const add = (label: string, value: string) => {
        if (value.trim()) {
            facts.push(`${label}: ${value}`);
        }
    };

    add("Decides by", humanizeEnum(reader.decisionStyle));
    add("Career right now", humanizeEnum(reader.careerStage));
    add("Relationship", humanizeEnum(reader.relationshipStatus));
    add("Cares about", humanizeEnums(reader.areasOfInterest).join(", "));

    const personality = selectContext(
        reader.personalityContext,
        focus,
        contacts.map((contact) => contact.natal)
    );

    const personalityBlock =
        personality.length > 0
            ? `

How they work:

${personality.map((line) => `- ${line}`).join("\n")}`
            : "";

    const placements = describeTouchedPlacements(reader.birthChart, contacts);

    const placementBlock =
        placements.length > 0
            ? `

What today is landing on in their chart:

${placements.join("\n")}`
            : "";

    const register = [humanizeEnum(reader.beliefLevel), humanizeEnum(reader.contentPreference)].filter(Boolean);

    const registerLine =
        register.length > 0
            ? `

They describe their relationship to astrology as "${register[0]}" and prefer content that is "${register.at(-1)}". Match that register. Never write about it.`
            : "";

    return `==================================================
THE READER
==================================================

${facts.join("\n")}${personalityBlock}${placementBlock}

These are internal English labels for what the reader picked during sign-up, not phrases
to reuse. Understand what each one means and say it the way it is actually said in the
language you are writing in — "changing field" is a career change, not a field of grain.
Never translate one word for word.

HOW TO USE THIS

Choose AT MOST TWO of these facts — the ones today's influences genuinely touch — and let
them change what the influence MEANS. Not who the sentence is addressed to: what the
sentence says. Ignore the rest. A day where nothing about them is relevant is a day where
you mention nothing about them.

Use, never name. "You take your time with decisions, so today's pressure to answer now
will feel like being rushed" is right. "As a careful decision-maker, you may feel rushed"
is wrong — it labels them instead of interpreting for them. The same goes for their
relationship status and their career.

Never quote or restate how they work. It is the app's private picture of them, not
something they have read: it is the mechanism behind what you write, never the subject of
it.${registerLine}`;
}
