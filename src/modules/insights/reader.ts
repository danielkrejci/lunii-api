import { Gender } from "../../utils/natalUtils";
import { humanizeEnum, humanizeEnums, parseLLMJson } from "../../utils/stringUtils";
import { NatalChart, NatalPoint, PERSONAL_POINTS } from "../astro";

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
    goalsForTheYear: string[];
    beliefLevel: string;
    contentPreference: string;
    /** The five-section profile written at onboarding, as the JSON string it is stored as. */
    personalityProfile: string;
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

/** The five sections written at onboarding. Mirrors the personality-profile route. */
interface PersonalityProfileText {
    core: string;
    emotions: string;
    expression: string;
    relationships: string;
    growth: string;
}

/**
 * The stored profile, or null.
 *
 * Null covers three real cases and treats them alike: onboarding that failed and stored
 * five empty strings, a row written before the column meant this, and a client that put
 * something else there — the column round-trips through the client as an unvalidated
 * string. A block that says "not available" is worse than no block, so the caller drops
 * it entirely.
 */
function readPersonality(stored: string): PersonalityProfileText | null {
    // Checked before parsing rather than after: `parseLLMJson` reports a failure to the
    // console, and an unfinished onboarding is an ordinary state, not an incident.
    if (!stored.trim()) {
        return null;
    }

    const parsed = parseLLMJson<Partial<PersonalityProfileText>>(stored);

    if (!parsed) {
        return null;
    }

    const sections = [parsed.core, parsed.emotions, parsed.expression, parsed.relationships, parsed.growth];

    if (sections.some((section) => typeof section !== "string") || sections.every((section) => !section?.trim())) {
        return null;
    }

    return parsed as PersonalityProfileText;
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
export function buildReaderBlock(reader: Reader, contacts: TouchedPoint[] = []): string {
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
    add("Working towards this year", humanizeEnums(reader.goalsForTheYear).join(", "));

    const personality = readPersonality(reader.personalityProfile);

    const personalityBlock = personality
        ? `

How they work, from the profile they were given when they joined:

${[personality.core, personality.emotions, personality.relationships, personality.growth]
    .map((section) => section.trim())
    .filter(Boolean)
    .join(" ")}`
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

Never quote or restate the profile above. They have already read it: it is the mechanism
behind what you write, never the subject of it.${registerLine}`;
}
