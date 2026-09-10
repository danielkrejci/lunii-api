import { and, eq, inArray } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { compatibilityPeople, compatibilityPeopleScores, dailyInsights } from "../../db/schema";
import { SINGS_MAP, ZodiacSign } from "../../utils/natalUtils";
import { NatalChart, PLANETS, TransitChart } from "../astro";
import { ScoredAspect } from "../compatibilityPeople/types";
import { calculateDailyCompatibility } from "../compatibilityZodiac/scoring";
import { summarizePlanetInfluence } from "../dailyScore";
import { getDailyScore, getOrCreateTransits, ScoringProfile, scoreProfileForDate } from "../dailyScore/service";
import { DailyInsightContent, MOON_PHASE_LABEL } from "../insights";
import { elongation, moonIllumination } from "../moon";
import { describeMoonDay } from "../moon/today";
import { getMoonPhase } from "../transits";

type Db = FastifyInstance["db"];

/**
 * The two blocks of context that are the chat's own.
 *
 * Everything else the model is told — who the reader is, how to write, what language
 * to write it in — is imported unchanged from the generators that already exist. These
 * two are here because a conversation needs something a one-way horoscope does not.
 */

/* ============================================================
   THE CHART
============================================================ */

/** Degrees into the sign, which is how a placement is actually spoken about. */
function degreeInSign(longitude: number): number {
    return Math.floor(((longitude % 30) + 30) % 30);
}

/**
 * The reader's whole natal chart.
 *
 * The horoscope deliberately names at most four placements — the ones today is landing
 * on — because naming more turns a reading of the day into a reading of the chart. A
 * conversation inverts that: "what does my Venus mean?" is a question the reader is
 * entitled to ask about any point in it, and a model that has to answer "I don't have
 * that" about the reader's own chart is worse than useless.
 *
 * The Ascendant appears only when there is a birth time behind it. Computed from an
 * assumed noon it is an artefact, and stating it would be a fabrication — the same rule
 * `buildReaderBlock` applies to the placements it names.
 */
export function buildChartBlock(birthChart: NatalChart): string {
    const lines: string[] = [];

    // PLANETS rather than Object.keys: charts come back out of JSONB, where key order
    // is not guaranteed, and the list the model reads should not shuffle between turns.
    for (const planet of PLANETS) {
        const placement = birthChart[planet];

        if (!placement) {
            continue;
        }

        const retrograde = placement.retrograde ? ", retrograde" : "";

        lines.push(`- ${planet} in ${placement.sign}, ${degreeInSign(placement.longitude)}°${retrograde}`);
    }

    if (birthChart.ascendant) {
        lines.push(`- ascendant in ${birthChart.ascendant.sign}, ${degreeInSign(birthChart.ascendant.longitude)}°`);
    }

    const noBirthTime = birthChart.ascendant
        ? ""
        : `

They have no birth time on file, so there is no Ascendant and no houses. If they ask
about either, say that plainly — it needs a birth time, and you would be making it up.
Everything above is unaffected.`;

    return `==================================================
THEIR BIRTH CHART
==================================================

${lines.join("\n")}${noBirthTime}

This is the whole chart, and it is here so you can answer questions about any part of
it. It is reference, not subject matter: do not list it back, and do not bring up a
placement they did not ask about unless it genuinely answers what they did ask.`;
}

/* ============================================================
   TODAY
============================================================ */

/** The numbers, lowest and highest called out — usually what the question is about. */
function describeScores(scores: Record<string, number>): string {
    const areas = [
        ["overall", scores.overall],
        ["love", scores.love],
        ["career", scores.career],
        ["health", scores.health],
        ["mood", scores.mood],
    ] as const;

    // Overall is the summary, not a sixth area, so it is not eligible to be the extreme.
    const rankable = areas.slice(1);
    const lowest = rankable.reduce((low, area) => (area[1] < low[1] ? area : low));
    const highest = rankable.reduce((high, area) => (area[1] > high[1] ? area : high));

    return areas
        .map(([name, value]) => {
            const mark = name === lowest[0] ? "  ← lowest" : name === highest[0] ? "  ← highest" : "";

            return `- ${name}: ${value}${mark}`;
        })
        .join("\n");
}

/**
 * What the horoscope prompt calls `personalTransits`, in the same shape.
 *
 * This is the part that makes an answer theirs rather than the day's. Every other
 * block describes a sky everyone in the timezone shares; these aspects land on this
 * chart and no other.
 */
function describeTransits(
    impacts: ReturnType<typeof scoreProfileForDate>["breakdown"]["top"],
    birthChart: NatalChart
): string {
    return impacts
        .map((impact) => {
            // Absent only for the Ascendant of a reader with no birth time.
            const natalSign = birthChart[impact.natal]?.sign;
            const contact = natalSign ? `${impact.reason} in ${natalSign}` : impact.reason;

            return `- ${contact} — ${impact.title} (${impact.area}, ${impact.value >= 0 ? "supportive" : "difficult"})
  ${impact.description}`;
        })
        .join("\n");
}

/**
 * Every body, how loud it is, and every aspect it is actually making.
 *
 * The aspects matter as much as the scores. `breakdown.top` carries the eight the day
 * is most worth writing about, but a chart makes far more than eight contacts — on a
 * measured day, thirty-six — and four bodies had no described aspect at all. Asked what
 * Venus was doing, the model could see a score and a count and nothing else, which
 * leaves it a choice between refusing and inventing.
 *
 * The ones already described above are not repeated. The rest arrive as one line each,
 * without the rule's own sentence about them: eight of those sentences are useful
 * grounding, and twenty-eight are a formulaic wall of "today X supports Y without
 * friction" — the exact register VOICE_RULES spends a section banning. What a trine
 * between two bodies means is something the model knows better than the table does.
 */
function describePlanets(score: ReturnType<typeof scoreProfileForDate>): string {
    const described = new Set(
        score.breakdown.top.map((impact) => `${impact.transit}_${impact.aspect}_${impact.natal}`)
    );

    return summarizePlanetInfluence(score.impacts)
        .filter((planet) => planet.aspects > 0)
        .map((planet) => {
            const rest = planet.contacts
                .filter((contact) => !described.has(contact.id))
                .map(
                    (contact) =>
                        `  - ${contact.reason} — ${contact.title} (${
                            contact.value >= 0 ? "supportive" : "difficult"
                        }, ${contact.orb.toFixed(1)}° orb)`
                );

            const header = `- ${planet.name}: ${planet.score}/100, ${planet.aspects} aspect(s) to their chart`;

            return rest.length > 0 ? `${header}\n${rest.join("\n")}` : header;
        })
        .join("\n");
}

/**
 * How the day sits between the reader and each of the twelve signs.
 *
 * The Home screen shows this ranking, so "which sign suits me today" is a question the
 * app has already put in their head. Twelve lines and about sixty tokens — cheaper than
 * one paragraph of anything, and without it the chat has to answer a question it can
 * see the screen asking.
 *
 * Computed with the arguments in the same order the zodiac route uses, so the numbers
 * here are the numbers they were shown rather than a second opinion.
 */
function describeZodiacCompatibility(sunSign: ZodiacSign, transits: TransitChart): string {
    const ranked = SINGS_MAP.map((sign) => ({
        sign,
        score: calculateDailyCompatibility(sign, sunSign, transits).score,
    })).sort((a, b) => b.score - a.score);

    return ranked.map((entry) => `- ${entry.sign}: ${entry.score}/100`).join("\n");
}

/**
 * How many of a person's aspects the block names. The strongest few decide the day;
 * past that it stops being why today is what it is and becomes a chart reading.
 */
const COMPATIBILITY_ASPECT_LIMIT = 4;

/** "Venus square Saturn — Affection meets restraint" for one side of a pairing. */
function describeCompatibilityAspects(aspects: ScoredAspect[]): string[] {
    return aspects.slice(0, COMPATIBILITY_ASPECT_LIMIT).map((scored) => {
        const { planetA, planetB, aspect } = scored.aspect;

        return `    - ${planetA} ${aspect} ${planetB} — ${scored.rule.title}`;
    });
}

/**
 * The people the reader has saved, and how today sits between them.
 *
 * Deterministic only — names, signs, scores, aspects — and never the written reading
 * stored alongside them. That reading costs 678 tokens a person against 126 for this,
 * and says nothing this does not: it is the app's wording of these same aspects.
 *
 * Included at all because without it the chat does not know these people exist. Asked
 * "how are things with Petra today", a model with the whole sky and no Petra has only
 * two moves, and one of them is to invent her.
 */
async function describeCompatibility(db: Db, input: { userId: string; date: string }): Promise<string> {
    const people = await db
        .select({
            id: compatibilityPeople.id,
            name: compatibilityPeople.name,
            relationship: compatibilityPeople.relationship,
            gender: compatibilityPeople.gender,
            birthDate: compatibilityPeople.birthDate,
            sunSign: compatibilityPeople.sunSign,
            moonSign: compatibilityPeople.moonSign,
            risingSign: compatibilityPeople.risingSign,
            baseScore: compatibilityPeople.baseScore,
        })
        .from(compatibilityPeople)
        .where(eq(compatibilityPeople.userId, input.userId));

    if (people.length === 0) {
        return "";
    }

    const scores = await db
        .select({
            personId: compatibilityPeopleScores.personId,
            score: compatibilityPeopleScores.score,
            compatibility: compatibilityPeopleScores.compatibility,
        })
        .from(compatibilityPeopleScores)
        .where(
            and(
                inArray(
                    compatibilityPeopleScores.personId,
                    people.map((person) => person.id)
                ),
                eq(compatibilityPeopleScores.date, input.date)
            )
        );

    const today = new Map(scores.map((row) => [row.personId, row]));

    const lines = people.map((person) => {
        const daily = today.get(person.id);

        const placements = [
            `${person.sunSign} sun`,
            person.moonSign ? `${person.moonSign} moon` : null,
            person.risingSign ? `${person.risingSign} rising` : "no birth time, so no rising sign",
        ]
            .filter(Boolean)
            .join(", ");

        const supportive = describeCompatibilityAspects(daily?.compatibility?.positiveAspects ?? []);
        const difficult = describeCompatibilityAspects(daily?.compatibility?.negativeAspects ?? []);

        const aspects = [
            supportive.length > 0 ? `  supportive between them today:\n${supportive.join("\n")}` : "",
            difficult.length > 0 ? `  difficult between them today:\n${difficult.join("\n")}` : "",
        ]
            .filter(Boolean)
            .join("\n");

        return `- ${person.name} — ${person.relationship}, ${person.gender}, born ${person.birthDate}
  ${placements}
  compatibility overall ${person.baseScore}/100${daily ? `, today ${daily.score}/100` : ", not scored for today"}${aspects ? `\n${aspects}` : ""}`;
    });

    return `

--------------------------------------------------
PEOPLE THEY HAVE SAVED
--------------------------------------------------

${lines.join("\n")}

These are the only people you know about. If they ask about someone who is not here, say
you do not have them yet rather than reading for a name — you have no birth data for
anyone else, and a reading without it is invention.`;
}

/**
 * The horoscope they have already read, when it exists.
 *
 * Without it, "what does today's horoscope mean?" is answered about a different
 * reading than the one on their screen — and the reader has no way to know why the two
 * disagree. With it, the chat and the Home tab are demonstrably one product.
 *
 * Omitted entirely while the day is still generating rather than replaced with a note
 * saying so. Telling a model that something it might have had is missing is worse than
 * not raising the subject — the same rule `buildReaderBlock` applies to a profile field
 * the reader never filled in.
 */
function describeHoroscope(content: DailyInsightContent | null): string {
    if (!content) {
        return "";
    }

    const areas = (["love", "career", "health", "mood", "overall"] as const)
        .map((area) => `- ${area}: ${content.insights[area].insight} (${content.insights[area].reason})`)
        .join("\n");

    return `

--------------------------------------------------
WHAT THEY HAVE ALREADY READ TODAY
--------------------------------------------------

This is their horoscope for today, in their own language, as it appears on their home
screen. When they say "my horoscope" or ask what something in it meant, this is the
text they mean.

${content.overview.title}
${content.overview.description}

${content.deepInsight.join("\n\n")}

The Moon note: ${content.moon.insight}

Opportunity: ${content.opportunity.description}
Watch out for: ${content.watchOut.description}

Per area:
${areas}

Never quote this back at them or summarise it unprompted — they have read it. Use it to
know what they are referring to, and to say something they have not already been told.`;
}

/**
 * Everything about the reader's day, as one block.
 *
 * Assembled entirely from calls the insight routes already make, and from the stored
 * row rather than a fresh computation: the scores here have to be the numbers on their
 * screen. `daily_insights` never overwrites a score once written, so recomputing could
 * quietly answer about numbers they were never shown.
 */
export async function buildDayContext(
    db: Db,
    input: { userId: string; profile: ScoringProfile; date: string }
): Promise<string> {
    const { date } = input;

    const transitData = await getOrCreateTransits(db, date, input.profile.timezone);
    const score = scoreProfileForDate(input.profile, transitData.planets);

    // The stored row, created if this is the first the app has heard of the day.
    const stored = await getDailyScore(db, input);

    const written = await db.query.dailyInsights.findFirst({
        columns: { content: true, status: true },
        where: and(eq(dailyInsights.userId, input.userId), eq(dailyInsights.date, date)),
    });

    const moon = describeMoonDay({
        date,
        timezone: input.profile.timezone,
        sunLongitude: transitData.planets.sun.longitude,
        moonLongitude: transitData.planets.moon.longitude,
        moonSign: transitData.planets.moon.sign,
    });

    const illumination = Math.round(
        moonIllumination(elongation(transitData.planets.moon.longitude, transitData.planets.sun.longitude))
    );

    // The app's own label, lowercased to sit inside a sentence rather than head a card.
    const phase =
        MOON_PHASE_LABEL[
            getMoonPhase(transitData.planets.sun.longitude, transitData.planets.moon.longitude)
        ].toLowerCase();

    // `ScoringProfile` carries no sun sign, but the chart it does carry is where the
    // stored one came from — deriving it keeps this function's input unchanged.
    const sunSign = input.profile.birthChart.sun.sign;

    const compatibility = await describeCompatibility(db, { userId: input.userId, date });

    const horoscope = describeHoroscope(written?.status === "ready" && written.content ? written.content : null);

    return `==================================================
THEIR DAY — ${date}
==================================================

THE NUMBERS ON THEIR SCREEN TODAY (0–100)

${describeScores({
    overall: stored.overallScore,
    love: stored.loveScore,
    career: stored.careerScore,
    health: stored.healthScore,
    mood: stored.moodScore,
})}

These are the exact numbers the app is showing them. If they ask why one is low, answer
from what is below, never from a guess — and never quote a number they did not mention
unless it is the one they asked about.

--------------------------------------------------
WHAT TODAY IS DOING TO THEIR CHART
--------------------------------------------------

${describeTransits(score.breakdown.top, input.profile.birthChart)}

This is the only part of today that is theirs. Everything else here is the sky everyone
in their timezone is under.

--------------------------------------------------
EVERY BODY, AND EVERY ASPECT IT IS MAKING TO THEM
--------------------------------------------------

${describePlanets(score)}

The aspects already described above are not repeated here. If they ask about a body
whose aspects appear only in this list, interpret them yourself — you have the pair, the
angle, how exact it is and which way it leans. If a body is not in this list at all, it
is making no aspect to their chart today, and saying so is a real answer.

--------------------------------------------------
THE MOON
--------------------------------------------------

${phase} in ${transitData.planets.moon.sign}, ${illumination}% lit.
Next full Moon in ${moon.nextFullMoon.daysRemaining} day(s), next new Moon in ${moon.nextNewMoon.daysRemaining} day(s).

--------------------------------------------------
HOW TODAY SITS BETWEEN THEM AND EACH SIGN
--------------------------------------------------

Their own Sun is in ${sunSign}. Best match first:

${describeZodiacCompatibility(sunSign, transitData.planets)}

This is sign to sign, which is the blunt version. Someone they have actually saved,
below, is scored from two whole charts and is the better answer whenever the question is
about a real person.${compatibility}${horoscope}`;
}
