import { ZodiacSign } from "../../utils/natalUtils";
import { NatalAspect } from "./aspects";
import { NatalChart, NatalPoint, NATAL_POINTS, Planet } from "./types";

/**
 * The parts of a chart that are counted rather than interpreted: the dominant element,
 * the dominant modality and which planets matter most.
 *
 * Computed here and handed to the model as facts. Asked to work them out itself, a model
 * counts a chart differently every time — and these are shown to the reader as labels,
 * where a different answer on the next rewrite reads as the app changing its mind about
 * who they are.
 */

export type Element = "fire" | "earth" | "air" | "water";
export type Modality = "cardinal" | "fixed" | "mutable";

export const ELEMENTS: readonly Element[] = ["fire", "earth", "air", "water"];
export const MODALITIES: readonly Modality[] = ["cardinal", "fixed", "mutable"];

export const SIGN_ELEMENT: Record<ZodiacSign, Element> = {
    aries: "fire",
    taurus: "earth",
    gemini: "air",
    cancer: "water",
    leo: "fire",
    virgo: "earth",
    libra: "air",
    scorpio: "water",
    sagittarius: "fire",
    capricorn: "earth",
    aquarius: "air",
    pisces: "water",
};

export const SIGN_MODALITY: Record<ZodiacSign, Modality> = {
    aries: "cardinal",
    taurus: "fixed",
    gemini: "mutable",
    cancer: "cardinal",
    leo: "fixed",
    virgo: "mutable",
    libra: "cardinal",
    scorpio: "fixed",
    sagittarius: "mutable",
    capricorn: "cardinal",
    aquarius: "fixed",
    pisces: "mutable",
};

/* ============================================================
   ELEMENT & MODALITY
============================================================ */

/**
 * How much each point counts towards the balance.
 *
 * The Sun, the Moon and the Ascendant carry the most weight, as they do in any reading
 * of temperament. Uranus, Neptune and Pluto carry none: they sit in one sign for years,
 * so counting them would make a whole birth cohort share its dominant element.
 */
const BALANCE_WEIGHT: Record<NatalPoint, number> = {
    sun: 3,
    moon: 3,
    ascendant: 3,
    mercury: 2,
    venus: 2,
    mars: 2,
    jupiter: 1,
    saturn: 1,
    uranus: 0,
    neptune: 0,
    pluto: 0,
};

/** Who wins a tie: the Sun's quality, then the Moon's, then the Ascendant's. */
const TIE_BREAK: readonly NatalPoint[] = ["sun", "moon", "ascendant"];

export interface Balance<K extends string> {
    key: K;
    /** Weighted points per quality, summing to the total weight of the chart. */
    distribution: Record<K, number>;
}

function dominant<K extends string>(
    chart: NatalChart,
    keys: readonly K[],
    quality: (sign: ZodiacSign) => K
): Balance<K> {
    const distribution = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

    // NATAL_POINTS rather than the chart's own keys: read back from JSONB they come in
    // any order, and the tie-break below must not depend on it.
    for (const point of NATAL_POINTS) {
        const position = chart[point];

        // The Ascendant is absent without a birth time, and then it simply does not vote.
        if (position) {
            distribution[quality(position.sign)] += BALANCE_WEIGHT[point];
        }
    }

    const top = Math.max(...keys.map((key) => distribution[key]));
    const tied = keys.filter((key) => distribution[key] === top);

    const breaker = TIE_BREAK.map((point) => chart[point])
        .filter((position) => position !== undefined)
        .map((position) => quality(position.sign))
        .find((key) => tied.includes(key));

    return { key: breaker ?? tied[0], distribution };
}

export function dominantElement(chart: NatalChart): Balance<Element> {
    return dominant(chart, ELEMENTS, (sign) => SIGN_ELEMENT[sign]);
}

export function dominantModality(chart: NatalChart): Balance<Modality> {
    return dominant(chart, MODALITIES, (sign) => SIGN_MODALITY[sign]);
}

/* ============================================================
   KEY PLANETS
============================================================ */

/**
 * The planets a profile can single out.
 *
 * Not the Sun or the Moon, which have cards of their own, and not the outer three, which
 * describe a generation rather than a person.
 */
export type KeyPlanet = Extract<Planet, "mercury" | "venus" | "mars" | "jupiter" | "saturn">;

/** Also the tie-break: the personal planets before the slow ones. */
export const KEY_PLANET_CANDIDATES: readonly KeyPlanet[] = ["venus", "mars", "mercury", "saturn", "jupiter"];

/**
 * Signs where a planet is unusually strong or unusually uncomfortable — domicile,
 * exaltation, detriment, fall. Either way the placement colours the person more than an
 * ordinary one, which is all the selection needs to know.
 */
const NOTABLE_SIGNS: Record<KeyPlanet, readonly ZodiacSign[]> = {
    mercury: ["gemini", "virgo", "sagittarius", "pisces"],
    venus: ["taurus", "libra", "pisces", "scorpio", "aries", "virgo"],
    mars: ["aries", "scorpio", "capricorn", "libra", "taurus", "cancer"],
    jupiter: ["sagittarius", "pisces", "cancer", "gemini", "virgo", "capricorn"],
    saturn: ["capricorn", "aquarius", "libra", "cancer", "leo", "aries"],
};

const LUMINARIES: readonly NatalPoint[] = ["sun", "moon", "ascendant"];
const PERSONAL_PLANETS: readonly NatalPoint[] = ["mercury", "venus", "mars"];

/**
 * A head start for the planets that move fast enough to differ between two people born
 * a few weeks apart. Jupiter and Saturn have to earn their place through the chart.
 */
const PERSONAL_BONUS = 0.5;
const NOTABLE_SIGN_BONUS = 0.75;
/** A planet in the Sun's sign mostly repeats the Sun card above it. */
const SAME_SIGN_AS_SUN_PENALTY = 0.75;

export interface KeyPlacement {
    planet: KeyPlanet;
    sign: ZodiacSign;
    retrograde: boolean;
}

function aspectWeight(other: NatalPoint): number {
    if (LUMINARIES.includes(other)) {
        return 2;
    }

    return PERSONAL_PLANETS.includes(other) ? 1 : 0.5;
}

/**
 * The planets that shape this chart most, strongest first.
 *
 * A planet scores for every standing aspect it makes — double when the other end is the
 * Sun, the Moon or the Ascendant — and for sitting in a sign where it is notably strong or
 * weak. Deterministic: the same chart always yields the same planets in the same order.
 */
export function selectKeyPlanets(chart: NatalChart, aspects: NatalAspect[], limit = 3): KeyPlacement[] {
    const scored = KEY_PLANET_CANDIDATES.map((planet, order) => {
        const position = chart[planet];
        let score = PERSONAL_PLANETS.includes(planet) ? PERSONAL_BONUS : 0;

        for (const aspect of aspects) {
            if (aspect.a === planet) {
                score += aspect.strength * aspectWeight(aspect.b);
            } else if (aspect.b === planet) {
                score += aspect.strength * aspectWeight(aspect.a);
            }
        }

        if (NOTABLE_SIGNS[planet].includes(position.sign)) {
            score += NOTABLE_SIGN_BONUS;
        }

        if (position.sign === chart.sun.sign) {
            score -= SAME_SIGN_AS_SUN_PENALTY;
        }

        return { planet, order, score, position };
    });

    return scored
        .sort((x, y) => y.score - x.score || x.order - y.order)
        .slice(0, limit)
        .map(({ planet, position }) => ({
            planet,
            sign: position.sign,
            retrograde: position.retrograde ?? false,
        }));
}
