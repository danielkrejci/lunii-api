import { getPointPosition } from "../astro";

/** Days in a mean synodic month. Only ever used to size a search window. */
const SYNODIC_MONTH = 29.530588853;

/** Unix epoch expressed as a Julian Day, the offset between the two scales. */
const UNIX_EPOCH_JD = 2_440_587.5;

const MS_PER_DAY = 86_400_000;

/**
 * Julian Day, to the millisecond.
 *
 * `getJulianDay` in modules/astro hands `swe_julday` the hour as
 * `getUTCHours() + getUTCMinutes() / 60` and drops everything below a minute. That is
 * harmless where it is used — natal charts and daily transits are sampled on a whole
 * minute — but it would cap a root search at one-minute resolution, and the search below
 * converges past that. Converting straight from the Unix epoch avoids the truncation
 * without touching a function every stored birth chart was computed with.
 */
export function julianDayPrecise(date: Date): number {
    return date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
}

function julianDayToDate(jd: number): Date {
    return new Date(Math.round((jd - UNIX_EPOCH_JD) * MS_PER_DAY));
}

/** Degrees the Moon stands ahead of the Sun, 0–360. Zero at the new moon, 180 at the full. */
export function elongation(moonLongitude: number, sunLongitude: number): number {
    return (((moonLongitude - sunLongitude) % 360) + 360) % 360;
}

/** The same angle, read from the ephemeris at an instant rather than from stored positions. */
export function moonElongation(jd: number): number {
    return elongation(getPointPosition(jd, "moon").longitude, getPointPosition(jd, "sun").longitude);
}

/**
 * Share of the disc lit, 0–100.
 *
 * The cosine of the elongation is the lit fraction. Shared with the daily horoscope so
 * both screens can never disagree about the same day.
 */
export function moonIllumination(degrees: number): number {
    return Math.round(((1 - Math.cos((degrees * Math.PI) / 180)) / 2) * 100);
}

export type Lunation = "new" | "full";

const LUNATION_ELONGATION: Record<Lunation, number> = { new: 0, full: 180 };

/**
 * How far the Moon stands from the event, in degrees, signed and normalized to −180..+180.
 *
 * The raw elongation is useless for root finding: for a new moon it runs 359° → 1° and
 * the crossing looks like a 358° cliff. Normalized, the value rises steadily from −180 to
 * +180 and passes through zero exactly once per lunation, which is the only place it can
 * be bisected.
 */
function offsetFromLunation(jd: number, target: number): number {
    const diff = moonElongation(jd) - target;

    return ((((diff + 180) % 360) + 360) % 360) - 180;
}

/** One second, as a fraction of a day. The precision the bisection converges to. */
const TOLERANCE = 1 / 86_400;

/** Bracketing step. The offset rises 10.8–14.4° a day, so a day can never hide a crossing. */
const STEP = 1;

function bisect(from: number, to: number, target: number): Date {
    let low = from;
    let high = to;

    while (high - low > TOLERANCE) {
        const mid = (low + high) / 2;

        if (offsetFromLunation(mid, target) < 0) {
            low = mid;
        } else {
            high = mid;
        }
    }

    return julianDayToDate((low + high) / 2);
}

/**
 * The first new or full moon at or after `from`, to the second.
 *
 * Steps forward a day at a time until the signed offset rises through zero, then bisects
 * that bracket. The wrap from +180 back to −180 falls the other way and is skipped, so
 * only the real crossing is ever bracketed.
 *
 * Costs roughly 100 ephemeris calls — a couple of milliseconds. `swisseph@0.5.17` exposes
 * no `swe_mooncross_ut`, so there is no primitive to defer to.
 */
export function nextLunation(from: Date, lunation: Lunation): Date {
    const target = LUNATION_ELONGATION[lunation];

    let low = julianDayPrecise(from);
    let lowOffset = offsetFromLunation(low, target);

    // One full month plus a day of slack: the crossing is always inside it.
    const limit = low + SYNODIC_MONTH + 1;

    while (low < limit) {
        const high = low + STEP;
        const highOffset = offsetFromLunation(high, target);

        if (lowOffset < 0 && highOffset >= 0) {
            return bisect(low, high, target);
        }

        low = high;
        lowOffset = highOffset;
    }

    // Unreachable for any real date; a throw beats returning a quietly wrong instant.
    throw new Error(`No ${lunation} moon within ${Math.ceil(SYNODIC_MONTH) + 1} days of ${from.toISOString()}`);
}
