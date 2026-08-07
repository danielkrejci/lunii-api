import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

import swisseph from "../../lib/swisseph";
import { SINGS_MAP } from "../../utils/natalUtils";
import { NatalChart, Planet, PLANETS, PointPosition, TransitChart } from "./types";

dayjs.extend(utc);
dayjs.extend(timezone);

/** Thrown when swisseph cannot produce a position. Routes map this to 409. */
export class EphemerisError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EphemerisError";
    }
}

const PLANET_IDS: Record<Planet, number> = {
    sun: swisseph.SE_SUN,
    moon: swisseph.SE_MOON,
    mercury: swisseph.SE_MERCURY,
    venus: swisseph.SE_VENUS,
    mars: swisseph.SE_MARS,
    jupiter: swisseph.SE_JUPITER,
    saturn: swisseph.SE_SATURN,
    uranus: swisseph.SE_URANUS,
    neptune: swisseph.SE_NEPTUNE,
    pluto: swisseph.SE_PLUTO,
};

/* ============================================================
   PRIMITIVES
============================================================ */

export function getJulianDay(date: Date): number {
    return swisseph.swe_julday(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        date.getUTCHours() + date.getUTCMinutes() / 60,
        swisseph.SE_GREG_CAL
    );
}

export function toPointPosition(longitude: number, speed?: number): PointPosition {
    const signIndex = Math.floor(longitude / 30);

    return {
        sign: SINGS_MAP[signIndex],
        signIndex,
        longitude,
        speed,
        retrograde: speed === undefined ? undefined : speed < 0,
    };
}

export function getPointPosition(jd: number, planet: Planet): PointPosition {
    const result = swisseph.swe_calc_ut(jd, PLANET_IDS[planet], swisseph.SEFLG_SWIEPH | swisseph.SEFLG_SPEED);

    if ("error" in result) {
        throw new EphemerisError(result.error);
    }

    if (!("longitude" in result) || !("longitudeSpeed" in result)) {
        throw new EphemerisError(`Invalid result from swe_calc_ut for ${planet}`);
    }

    return toPointPosition(result.longitude, result.longitudeSpeed);
}

export function getAscendant(jd: number, lat: number, lng: number): PointPosition {
    // The Ascendant is identical across house systems; "P" is only a required argument.
    const houses = swisseph.swe_houses(jd, lat, lng, "P");

    if ("error" in houses) {
        throw new EphemerisError(houses.error);
    }

    return toPointPosition(houses.ascendant);
}

/* ============================================================
   NATAL CHART
============================================================ */

export interface NatalChartInput {
    /** "YYYY-MM-DD", or anything dayjs can parse. */
    birthDate: string;
    /** "HH:mm" or an ISO datetime. Null means unknown — noon is assumed and the Ascendant is omitted. */
    birthTime: string | null;
    birthPlaceLat: number | null;
    birthPlaceLng: number | null;
    /** IANA zone the birth time is expressed in. */
    timezone: string;
}

export interface NatalChartResult {
    chart: NatalChart;
    /**
     * False when the birth time was unknown. Consumers must degrade: the Ascendant
     * is absent and the natal Moon can be up to ~6.6° off.
     */
    hasBirthTime: boolean;
}

function parseBirthTime(birthTime: string | null): { hour: number; minute: number } {
    if (!birthTime) {
        // Same assumption the routes have always made.
        return { hour: 12, minute: 0 };
    }

    const clockMatch = /^(\d{1,2}):(\d{2})/u.exec(birthTime);

    if (clockMatch) {
        return { hour: Number(clockMatch[1]), minute: Number(clockMatch[2]) };
    }

    const parsed = dayjs(birthTime);

    if (!parsed.isValid()) {
        throw new EphemerisError(`Invalid birth time: ${birthTime}`);
    }

    return { hour: parsed.hour(), minute: parsed.minute() };
}

/** Instant of birth in UTC. Exported so the calibration script can reuse it. */
export function toAbsoluteBirthDate(input: NatalChartInput): Date {
    const { hour, minute } = parseBirthTime(input.birthTime);

    return dayjs
        .tz(dayjs(input.birthDate).format("YYYY-MM-DD"), input.timezone)
        .hour(hour)
        .minute(minute)
        .second(0)
        .millisecond(0)
        .toDate();
}

/**
 * Ten planets plus the Ascendant. Replaces the seven-planet chart that used to be
 * built inline in three separate routes.
 */
export function computeNatalChart(input: NatalChartInput): NatalChartResult {
    const jd = getJulianDay(toAbsoluteBirthDate(input));

    const chart = {} as NatalChart;

    for (const planet of PLANETS) {
        chart[planet] = getPointPosition(jd, planet);
    }

    const hasBirthTime = input.birthTime !== null;

    // Without a birth time the Ascendant would just encode the assumed noon.
    if (hasBirthTime && input.birthPlaceLat !== null && input.birthPlaceLng !== null) {
        chart.ascendant = getAscendant(jd, input.birthPlaceLat, input.birthPlaceLng);
    }

    return { chart, hasBirthTime };
}

/* ============================================================
   TRANSIT CHART
============================================================ */

/**
 * Transit positions for a given instant. Takes an explicit Date rather than a
 * date string so intraday sampling (peak hours) needs no signature change.
 */
export function computeTransitChart(at: Date): TransitChart {
    const jd = getJulianDay(at);

    const chart = {} as TransitChart;

    for (const planet of PLANETS) {
        chart[planet] = getPointPosition(jd, planet);
    }

    return chart;
}

/**
 * Local noon of a "YYYY-MM-DD" date in a zone — the sampling instant for daily scores.
 *
 * Noon rather than midnight because it is the middle of the day being described, so the
 * fastest body, the Moon, is never more than twelve hours of motion away from any hour
 * the user might be reading about.
 */
export function transitInstantForDate(date: string, utcOffsetMinutes: number): Date {
    return dayjs
        .utc(date)
        .startOf("day")
        .add(12 * 60 - utcOffsetMinutes, "minute")
        .toDate();
}
