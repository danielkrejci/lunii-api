/**
 * Domain tests — the application's astrological philosophy, not its implementation.
 *
 * These assert what an aspect MUST do, independent of the numbers that happen to
 * be in rules.ts today. When a rule is retuned and a test here fails, that is the
 * point: it means the change contradicted a stated belief about the astrology.
 *
 *   pnpm test
 *
 * A failing test is either a bug in the table or a belief that needs revising.
 * Both are useful; silently drifting away from either is not.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASPECT_RULES, evaluateAspect } from ".";
import { AspectType, LifeArea, NatalPoint, Planet } from "../astro";

/* ============================================================
   HELPERS
============================================================ */

function evaluate(transit: Planet, aspect: AspectType, natal: NatalPoint) {
    const result = evaluateAspect(transit, aspect, natal);

    assert.ok(result, `no rule covers transit ${transit} ${aspect} natal ${natal}`);

    return result;
}

function label(transit: Planet, aspect: AspectType, natal: NatalPoint): string {
    return `transit ${transit} ${aspect} natal ${natal}`;
}

function decreases(transit: Planet, aspect: AspectType, natal: NatalPoint, area: LifeArea): void {
    const { areas } = evaluate(transit, aspect, natal);

    assert.ok(
        areas[area] < 0,
        `${label(transit, aspect, natal)} should decrease ${area}, got ${areas[area].toFixed(2)}`
    );
}

function increases(transit: Planet, aspect: AspectType, natal: NatalPoint, area: LifeArea): void {
    const { areas } = evaluate(transit, aspect, natal);

    assert.ok(
        areas[area] > 0,
        `${label(transit, aspect, natal)} should increase ${area}, got ${areas[area].toFixed(2)}`
    );
}

/** Which area an aspect is mainly about, without claiming the other is untouched. */
function outweighs(transit: Planet, aspect: AspectType, natal: NatalPoint, stronger: LifeArea, weaker: LifeArea): void {
    const { areas } = evaluate(transit, aspect, natal);

    assert.ok(
        Math.abs(areas[stronger]) > Math.abs(areas[weaker]),
        `${label(transit, aspect, natal)} should weigh ${stronger} over ${weaker}, ` +
            `got ${stronger} ${areas[stronger].toFixed(2)} vs ${weaker} ${areas[weaker].toFixed(2)}`
    );
}

function affects(transit: Planet, aspect: AspectType, natal: NatalPoint, area: LifeArea, minimum = 0.3): void {
    const { areas } = evaluate(transit, aspect, natal);

    assert.ok(
        Math.abs(areas[area]) >= minimum,
        `${label(transit, aspect, natal)} should measurably affect ${area}, got ${areas[area].toFixed(2)}`
    );
}

/** Guards against rules that exist but are numerically inert. */
function isNotInert(transit: Planet, aspect: AspectType, natal: NatalPoint, minimum = 1): void {
    const { total } = evaluate(transit, aspect, natal);

    assert.ok(
        Math.abs(total) >= minimum,
        `${label(transit, aspect, natal)} is inert (total ${total.toFixed(2)}, need |${minimum}|)`
    );
}

function dominantArea(transit: Planet, aspect: AspectType, natal: NatalPoint, area: LifeArea): void {
    const result = evaluate(transit, aspect, natal);

    assert.equal(
        result.dominant,
        area,
        `${label(transit, aspect, natal)} should land mainly on ${area}, landed on ${result.dominant}`
    );
}

/* ============================================================
   SATURN — structure, limits, weight
============================================================ */

describe("Saturn", () => {
    it("square natal Moon lowers mood", () => decreases("saturn", "square", "moon", "mood"));

    it("opposition natal Moon lowers mood", () => decreases("saturn", "opposition", "moon", "mood"));

    it("square natal Sun lowers career", () => decreases("saturn", "square", "sun", "career"));

    it("square natal Venus lowers love", () => decreases("saturn", "square", "venus", "love"));

    // Saturn trine Sun can mean stability and commitment, so love is not zero —
    // but the aspect is about earned structure, so career must outweigh it.
    it("trine natal Sun weighs career over love", () => outweighs("saturn", "trine", "sun", "career", "love"));

    it("conjunction natal Ascendant affects health", () => affects("saturn", "conjunction", "ascendant", "health"));

    it("conjunction natal Sun is a real event, not noise", () => isNotInert("saturn", "conjunction", "sun"));

    it("conjunction natal Moon is a real event, not noise", () => isNotInert("saturn", "conjunction", "moon"));
});

/* ============================================================
   JUPITER — growth, opportunity
============================================================ */

describe("Jupiter", () => {
    it("trine natal Sun increases career", () => increases("jupiter", "trine", "sun", "career"));

    it("trine natal Venus increases love", () => increases("jupiter", "trine", "venus", "love"));

    it("trine natal Moon increases mood", () => increases("jupiter", "trine", "moon", "mood"));

    it("sextile natal Mercury increases career", () => increases("jupiter", "sextile", "mercury", "career"));

    it("never strongly lowers mood, even when challenging", () => {
        const { areas } = evaluate("jupiter", "square", "moon");

        assert.ok(areas.mood > -3, `Jupiter square Moon should be mild on mood, got ${areas.mood.toFixed(2)}`);
    });
});

/* ============================================================
   VENUS — affection, ease
============================================================ */

describe("Venus", () => {
    it("conjunction natal Venus increases love", () => increases("venus", "conjunction", "venus", "love"));

    it("conjunction natal Moon increases mood", () => increases("venus", "conjunction", "moon", "mood"));

    it("trine natal Sun increases love", () => increases("venus", "trine", "sun", "love"));

    it("aspects to natal Venus land mainly on love", () => dominantArea("venus", "trine", "venus", "love"));

    it("has a positive average impact across all its harmonious aspects", () => {
        const targets: NatalPoint[] = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "ascendant"];

        const totals = targets.map((target) => evaluate("venus", "trine", target).total);
        const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;

        assert.ok(average > 1, `Venus trines should average clearly positive, got ${average.toFixed(2)}`);
    });
});

/* ============================================================
   MARS — drive, friction
============================================================ */

describe("Mars", () => {
    it("square natal Sun lowers career", () => decreases("mars", "square", "sun", "career"));

    it("square natal Moon lowers mood", () => decreases("mars", "square", "moon", "mood"));

    it("square natal Mars affects health", () => affects("mars", "square", "mars", "health"));

    it("trine natal Sun increases career", () => increases("mars", "trine", "sun", "career"));

    it("conjunction natal Sun is a real event, not noise", () => isNotInert("mars", "conjunction", "sun"));

    it("conjunction natal Moon is a real event, not noise", () => isNotInert("mars", "conjunction", "moon"));

    it("does not make health a Mars-and-Saturn-only story", () => {
        /**
         * This used to compare Venus-Venus against Mars-Mars, which stopped meaning
         * anything once the areas were concentrated: Venus-Venus is now pure love and
         * legitimately carries no health at all. The intent survives, so it is asserted
         * where it belongs — over the table, not over one pair.
         */
        const healthPairs = ASPECT_RULES.filter((rule) => (rule.areas.health ?? 0) >= 0.3);
        const bodies = new Set(healthPairs.flatMap((rule) => rule.pair));

        assert.ok(
            bodies.size >= 6,
            `health should be fed by at least 6 distinct points, got ${[...bodies].sort().join(", ")}`
        );

        const harsh = healthPairs.filter((rule) => rule.pair.includes("mars") || rule.pair.includes("saturn"));

        assert.ok(
            harsh.length / healthPairs.length < 0.6,
            `Mars and Saturn carry ${harsh.length} of ${healthPairs.length} health-heavy rules — too much of one flavour`
        );
    });
});

/* ============================================================
   MOON — feeling, rhythm
============================================================ */

describe("Moon", () => {
    it("aspects to natal Moon land mainly on mood", () => dominantArea("moon", "trine", "moon", "mood"));

    it("trine natal Venus increases love", () => increases("moon", "trine", "venus", "love"));

    it("square natal Neptune lowers mood", () => decreases("moon", "square", "neptune", "mood"));

    it("conjunction natal Uranus is a real event, not noise", () => isNotInert("moon", "conjunction", "uranus"));

    it("reaches health — sleep and appetite are lunar", () => affects("moon", "trine", "moon", "health"));
});

/* ============================================================
   SUN — identity, vitality
============================================================ */

describe("Sun", () => {
    it("trine natal Jupiter increases career", () => increases("sun", "trine", "jupiter", "career"));

    it("square natal Saturn lowers career", () => decreases("sun", "square", "saturn", "career"));

    it("conjunction natal Sun is a real event — the solar return", () => isNotInert("sun", "conjunction", "sun", 2));

    it("conjunction natal Uranus is a real event, not noise", () => isNotInert("sun", "conjunction", "uranus"));

    it("conjunction natal Pluto is a real event, not noise", () => isNotInert("sun", "conjunction", "pluto"));
});

/* ============================================================
   MERCURY — mind, exchange
============================================================ */

describe("Mercury", () => {
    it("aspects to natal Mercury land mainly on career", () => dominantArea("mercury", "trine", "mercury", "career"));

    it("square natal Saturn lowers career", () => decreases("mercury", "square", "saturn", "career"));

    it("conjunction natal Uranus is a real event, not noise", () => isNotInert("mercury", "conjunction", "uranus"));

    it("conjunction natal Neptune is a real event, not noise", () => isNotInert("mercury", "conjunction", "neptune"));
});

/* ============================================================
   STRUCTURAL INVARIANTS
============================================================ */

describe("structure", () => {
    it("harmonious never scores below challenging for the same pair", () => {
        const pairs: [Planet, NatalPoint][] = [
            ["saturn", "moon"],
            ["venus", "sun"],
            ["mars", "mercury"],
            ["jupiter", "venus"],
            ["moon", "ascendant"],
        ];

        for (const [transit, natal] of pairs) {
            const harmonious = evaluate(transit, "trine", natal).total;
            const challenging = evaluate(transit, "square", natal).total;

            assert.ok(
                challenging < harmonious,
                `${transit}-${natal}: square (${challenging.toFixed(2)}) must score below trine (${harmonious.toFixed(2)})`
            );
        }
    });

    it("a tighter orb never weakens an aspect", () => {
        const loose = evaluateAspect("saturn", "square", "moon", 0.2);
        const tight = evaluateAspect("saturn", "square", "moon", 0.9);

        assert.ok(loose && tight);
        assert.ok(
            Math.abs(tight.total) > Math.abs(loose.total),
            `tight orb ${tight.total.toFixed(2)} should exceed loose orb ${loose.total.toFixed(2)}`
        );
    });

    it("a fast transit outweighs the same aspect from a slow one on a single day", () => {
        // Duration is expressed by persistence across days, not by daily amplitude.
        const fast = evaluate("moon", "square", "saturn").total;
        const slow = evaluate("saturn", "square", "moon").total;

        assert.ok(
            Math.abs(fast) > Math.abs(slow),
            `transit Moon (${fast.toFixed(2)}) should hit harder in one day than transit Saturn (${slow.toFixed(2)})`
        );
    });

    it("outer planets aspecting each other are excluded", () => {
        assert.equal(evaluateAspect("pluto", "square", "uranus"), null);
        assert.equal(evaluateAspect("neptune", "trine", "pluto"), null);
    });

    it("every area share of a resolved rule is positive and sums to 1", () => {
        const result = evaluate("venus", "trine", "moon");
        const shares = Object.values(result.rule.areas) as number[];

        assert.ok(shares.every((share) => share > 0));
        assert.ok(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 1) < 1e-9);
    });
});
