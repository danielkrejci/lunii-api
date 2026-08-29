import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

import { ZodiacSign } from "../../utils/natalUtils";
import { MoonPhase } from "../astro";
import { getMoonPhase } from "../transits";
import { elongation, moonIllumination, nextLunation } from "./lunation";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

/**
 * Which prompt wrote the day's text, and which layout the client shows.
 *
 * Stored alongside the copy rather than derived from the phase at read time: the text is
 * written once in the morning, and a hero that disagrees with the words under it is worse
 * than a hero that is a few hours stale.
 */
export type MoonVariant = "generic" | "fullMoon" | "newMoon";

export const MOON_VARIANTS: readonly MoonVariant[] = ["generic", "fullMoon", "newMoon"];

export interface UpcomingLunation {
    /** Local calendar date of the event, "YYYY-MM-DD". */
    date: string;
    /** Whole calendar days from the day being described. 0 means it happens today. */
    daysRemaining: number;
}

export interface MoonToday {
    sign: ZodiacSign;
    phase: MoonPhase;
    /** 0–100. Share of the disc lit today. */
    illumination: number;
    variant: MoonVariant;
    nextFullMoon: UpcomingLunation;
    nextNewMoon: UpcomingLunation;
}

/** Midnight opening the date in the user's zone. Profiles saved before the app recorded a zone fall back to UTC. */
function startOfLocalDay(date: string, timezone: string | null): Date {
    return timezone ? dayjs.tz(date, timezone).startOf("day").toDate() : dayjs.utc(date).startOf("day").toDate();
}

function toLocalDate(at: Date, timezone: string | null): string {
    return timezone ? dayjs(at).tz(timezone).format("YYYY-MM-DD") : dayjs.utc(at).format("YYYY-MM-DD");
}

function upcoming(at: Date, date: string, timezone: string | null): UpcomingLunation {
    const local = toLocalDate(at, timezone);

    return {
        date: local,
        // Both parsed as UTC midnight, so the difference is whole days and never a
        // fraction rounded the wrong way by a daylight-saving shift.
        daysRemaining: dayjs.utc(local).diff(dayjs.utc(date), "day"),
    };
}

/**
 * Everything about today's Moon that follows from the ephemeris alone.
 *
 * Recomputed on every read rather than stored: it is a pure function of the date and the
 * user's zone, so a stored copy could only ever go stale.
 *
 * The lunation search runs from the START of the user's local day, which is what makes
 * `daysRemaining: 0` and the hero agree — an event at 23:50 local still belongs to today.
 */
export function describeMoonDay(input: {
    date: string;
    timezone: string | null;
    sunLongitude: number;
    moonLongitude: number;
    moonSign: ZodiacSign;
}): MoonToday {
    const { date, timezone } = input;

    const from = startOfLocalDay(date, timezone);

    const nextFullMoon = upcoming(nextLunation(from, "full"), date, timezone);
    const nextNewMoon = upcoming(nextLunation(from, "new"), date, timezone);

    /**
     * The hero belongs to the calendar day the exact instant falls into — not to an
     * angular window around it.
     *
     * `getMoonPhase` buckets the cycle into eight 45° slices, so its `fullMoon` spans
     * ~3.7 days. Narrowing that window does not work either: transits are sampled once a
     * day at local noon and the elongation advances 10.8–14.4° a day, so a window tight
     * enough for one day (~12.2°) is sometimes narrower than the gap between samples and
     * skips the event entirely — measured at 3 of 50 lunations. Anchoring on the instant
     * gives exactly one day per lunation, with no gaps and no duplicates.
     */
    const variant: MoonVariant =
        nextFullMoon.daysRemaining === 0 ? "fullMoon" : nextNewMoon.daysRemaining === 0 ? "newMoon" : "generic";

    return {
        sign: input.moonSign,
        phase: getMoonPhase(input.sunLongitude, input.moonLongitude),
        /**
         * From the positions handed in, not re-read at midnight: those are the stored
         * transits, sampled at local noon, and the daily horoscope shows illumination
         * from the very same numbers. Two screens describing one day must not disagree.
         */
        illumination: moonIllumination(elongation(input.moonLongitude, input.sunLongitude)),
        variant,
        nextFullMoon,
        nextNewMoon,
    };
}
