import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { FastifyInstance } from "fastify";
import { AsyncTask, CronJob } from "toad-scheduler";

import { profile, transit } from "../db/schema";
import {
    getAngleDiff,
    getAspect,
    getExactAngle,
    TransitAspects,
    TransitAspectsPlanet,
    TransitPlanets,
} from "../utils/natalUtils";
import { computeTransitChart, transitInstantForDate } from "./astro";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

function computeAspects(planets: Partial<Record<TransitAspectsPlanet, { longitude: number }>>): TransitAspects {
    const entries = Object.entries(planets);
    const aspects: TransitAspects = [];

    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            const [p1, v1] = entries[i] as [TransitAspectsPlanet, { longitude: number }];
            const [p2, v2] = entries[j] as [TransitAspectsPlanet, { longitude: number }];

            const diff = getAngleDiff(v1.longitude, v2.longitude);
            const aspect = getAspect(diff);

            if (aspect) {
                aspects.push({
                    planets: [p1, p2],
                    type: aspect,
                    orb: Math.abs(diff - getExactAngle(aspect)),
                });
            }
        }
    }

    return aspects;
}

/** Single ephemeris implementation lives in modules/astro. */
export function computePlanetPositions(date: Date): TransitPlanets {
    return computeTransitChart(date) as TransitPlanets;
}

/**
 * Positions for a date as seen from a zone. Takes the date as a string and the offset
 * separately: the instant is local noon, which for the far ends of the world falls on a
 * different UTC day than the label, so the label cannot be derived back from it.
 */
export function computeTransits(
    date: string,
    utcOffsetMinutes: number
): {
    date: string;
    utcOffset: number;
    planets: TransitPlanets;
    aspects: TransitAspects;
} {
    const planets = computePlanetPositions(transitInstantForDate(date, utcOffsetMinutes));

    const aspects: TransitAspects = computeAspects(planets);

    return {
        date,
        utcOffset: utcOffsetMinutes,
        planets,
        aspects,
    };
}

/**
 * The offset a zone is on for a given date. Resolved per date rather than once, because
 * daylight saving moves half the world twice a year. Profiles saved before the app
 * recorded a zone fall back to UTC.
 */
export function utcOffsetForDate(date: string, timezone: string | null | undefined): number {
    if (!timezone) {
        return 0;
    }

    return dayjs.tz(date, timezone).utcOffset();
}

export async function executeTransitsGeneration(db: FastifyInstance["db"]) {
    console.log("[CRON] Generating transits...");

    // Only the zones somebody actually lives in, plus UTC. Rows for the rest are created
    // on the read path, on the day someone in that zone first asks.
    const zones = await db.selectDistinct({ timezone: profile.timezone }).from(profile);

    // -7 as well as +7: the read path scores a window around today, and computing
    // transits is pure CPU, so covering the past costs nothing.
    for (let i = -7; i <= 7; i++) {
        const date = dayjs.utc().startOf("day").add(i, "day").format("YYYY-MM-DD");

        const offsets = new Set<number>([0]);

        for (const zone of zones) {
            offsets.add(utcOffsetForDate(date, zone.timezone));
        }

        for (const utcOffset of offsets) {
            const data = computeTransits(date, utcOffset);

            await db
                .insert(transit)
                .values(data)
                .onConflictDoUpdate({
                    target: [transit.date, transit.utcOffset],
                    set: {
                        planets: data.planets,
                        aspects: data.aspects,
                    },
                });
        }
    }

    console.log("[CRON] Done");
}

export function createTransitJob(db: FastifyInstance["db"]) {
    const task = new AsyncTask(
        "generate-transits",
        async () => {
            await executeTransitsGeneration(db);
        },
        (err) => {
            console.error("[CRON ERROR]", err);
        }
    );

    const job = new CronJob(
        {
            cronExpression: "0 0 * * *",
        },
        task
    );

    return job;
}

export function getMoonPhase(sunDegree: number, moonDegree: number): string {
    const angle = (moonDegree - sunDegree + 360) % 360;

    if (angle < 22.5 || angle >= 337.5) {
        return "New Moon";
    }

    if (angle < 67.5) {
        return "Waxing Crescent";
    }

    if (angle < 112.5) {
        return "First Quarter";
    }

    if (angle < 157.5) {
        return "Waxing Gibbous";
    }

    if (angle < 202.5) {
        return "Full Moon";
    }

    if (angle < 247.5) {
        return "Waning Gibbous";
    }

    if (angle < 292.5) {
        return "Last Quarter";
    }

    return "Waning Crescent";
}
