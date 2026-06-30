import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { FastifyInstance } from "fastify";
import { AsyncTask, CronJob } from "toad-scheduler";

import { transit } from "../db/schema";
import swisseph from "../lib/swisseph";
import { getAngleDiff, getAspect, getExactAngle, signs } from "../utils/natalUtils";

dayjs.extend(utc);

function getJulianDate(date: Date) {
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60;

    return swisseph.swe_julday(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        hour,
        swisseph.SE_GREG_CAL
    );
}

function getPlanet(jd: number, planet: number) {
    const result = swisseph.swe_calc_ut(jd, planet, swisseph.SEFLG_SWIEPH);

    if ("error" in result) {
        throw new Error(result.error);
    }

    if (!("longitude" in result)) {
        throw new Error("Invalid result from swe_calc_ut");
    }

    const degree = result.longitude;

    return {
        degree,
        sign: signs[Math.floor(degree / 30)],
    };
}

function computeAspects(planets: Record<string, { degree: number }>) {
    const entries = Object.entries(planets);
    const aspects = [];

    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            const [p1, v1] = entries[i];
            const [p2, v2] = entries[j];

            const diff = getAngleDiff(v1.degree, v2.degree);
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

export function computeTransits(date: Date) {
    const jd = getJulianDate(date);

    const planets = {
        sun: getPlanet(jd, swisseph.SE_SUN),
        moon: getPlanet(jd, swisseph.SE_MOON),
        mercury: getPlanet(jd, swisseph.SE_MERCURY),
        venus: getPlanet(jd, swisseph.SE_VENUS),
        mars: getPlanet(jd, swisseph.SE_MARS),
        saturn: getPlanet(jd, swisseph.SE_SATURN),
    };

    const aspects = computeAspects(planets);

    return {
        date: dayjs.utc(date).format("YYYY-MM-DD"),
        planets,
        aspects,
    };
}

export async function executeTransitsGeneration(db: FastifyInstance["db"]) {
    console.log("[CRON] Generating transits...");

    for (let i = 0; i < 7; i++) {
        const date = dayjs.utc().startOf("day").add(i, "day").toDate();

        const data = computeTransits(date);

        await db
            .insert(transit)
            .values(data)
            .onConflictDoUpdate({
                target: transit.date,
                set: {
                    planets: data.planets,
                    aspects: data.aspects,
                },
            });
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
