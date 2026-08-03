import { Dayjs } from "dayjs";

import swisseph from "../lib/swisseph";

export const Genders = ["male", "female", "non_binary"] as const;
export type Gender = (typeof Genders)[number];

export const Relationships = ["partner", "crush", "friend", "family", "coworker", "acquaintance"] as const;
export type Relationship = (typeof Relationships)[number];

export type TransitPlanets = Record<
    "sun" | "moon" | "mercury" | "venus" | "mars" | "saturn" | "jupiter",
    {
        sign: ZodiacSign;
        longitude: number;
    }
>;

export type TransitAspectsPlanet =
    | "sun"
    | "moon"
    | "mercury"
    | "venus"
    | "mars"
    | "jupiter"
    | "saturn"
    | "uranus"
    | "neptune"
    | "pluto";

export type TransitAspects = {
    orb: number;
    type: "conjunction" | "opposition" | "trine" | "square" | "sextile";
    planets: [TransitAspectsPlanet, TransitAspectsPlanet];
}[];

export type ZodiacSign =
    | "aries"
    | "taurus"
    | "gemini"
    | "cancer"
    | "leo"
    | "virgo"
    | "libra"
    | "scorpio"
    | "sagittarius"
    | "capricorn"
    | "aquarius"
    | "pisces";

export const SINGS_MAP: readonly ZodiacSign[] = [
    "aries",
    "taurus",
    "gemini",
    "cancer",
    "leo",
    "virgo",
    "libra",
    "scorpio",
    "sagittarius",
    "capricorn",
    "aquarius",
    "pisces",
];

export const SINGS_OBJECT: Record<ZodiacSign, ZodiacSign> = {
    aries: "cancer",
    taurus: "leo",
    gemini: "virgo",
    cancer: "pisces",
    leo: "aries",
    virgo: "gemini",
    libra: "taurus",
    scorpio: "cancer",
    sagittarius: "pisces",
    capricorn: "cancer",
    aquarius: "pisces",
    pisces: "pisces",
};

export const SIGN_INDEX: Record<ZodiacSign, number> = {
    aries: 0,
    taurus: 1,
    gemini: 2,
    cancer: 3,
    leo: 4,
    virgo: 5,
    libra: 6,
    scorpio: 7,
    sagittarius: 8,
    capricorn: 9,
    aquarius: 10,
    pisces: 11,
};

export const SIGN_CENTER: Record<ZodiacSign, number> = {
    aries: 15,
    taurus: 45,
    gemini: 75,
    cancer: 105,
    leo: 135,
    virgo: 165,
    libra: 195,
    scorpio: 225,
    sagittarius: 255,
    capricorn: 285,
    aquarius: 315,
    pisces: 345,
};

export function getJulianDay(date: Dayjs): number {
    return swisseph.swe_julday(date.year(), date.month() + 1, date.date(), date.hour(), swisseph.SE_GREG_CAL);
}

export function getAngleDiff(a: number, b: number) {
    let diff = Math.abs(a - b);
    if (diff > 180) diff = 360 - diff;
    return diff;
}

export function getAngularDistance(longitudeA: number, longitudeB: number): number {
    const difference = Math.abs(longitudeA - longitudeB) % 360;

    return Math.min(difference, 360 - difference);
}

export function getAspect(diff: number): TransitAspects[number]["type"] | null {
    const orb = 6;

    if (Math.abs(diff - 0) < orb) return "conjunction";
    if (Math.abs(diff - 60) < orb) return "sextile";
    if (Math.abs(diff - 90) < orb) return "square";
    if (Math.abs(diff - 120) < orb) return "trine";
    if (Math.abs(diff - 180) < orb) return "opposition";

    return null;
}

export function getExactAngle(type: string) {
    switch (type) {
        case "conjunction":
            return 0;
        case "sextile":
            return 60;
        case "square":
            return 90;
        case "trine":
            return 120;
        case "opposition":
            return 180;
        default:
            return 0;
    }
}

export function getSunSign(date: Date): {
    name: ZodiacSign;
    dateFrom: Date;
    dateTo: Date;
} {
    const day = date.getDate();
    const month = date.getMonth() + 1;

    if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) {
        return {
            name: "aries",
            dateFrom: new Date(date.getFullYear(), 2, 21),
            dateTo: new Date(date.getFullYear(), 3, 19),
        };
    }
    if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) {
        return {
            name: "taurus",
            dateFrom: new Date(date.getFullYear(), 3, 20),
            dateTo: new Date(date.getFullYear(), 4, 20),
        };
    }
    if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) {
        return {
            name: "gemini",
            dateFrom: new Date(date.getFullYear(), 4, 21),
            dateTo: new Date(date.getFullYear(), 5, 20),
        };
    }
    if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) {
        return {
            name: "cancer",
            dateFrom: new Date(date.getFullYear(), 5, 21),
            dateTo: new Date(date.getFullYear(), 6, 22),
        };
    }
    if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) {
        return {
            name: "leo",
            dateFrom: new Date(date.getFullYear(), 6, 23),
            dateTo: new Date(date.getFullYear(), 7, 22),
        };
    }
    if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) {
        return {
            name: "virgo",
            dateFrom: new Date(date.getFullYear(), 7, 23),
            dateTo: new Date(date.getFullYear(), 8, 22),
        };
    }
    if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) {
        return {
            name: "libra",
            dateFrom: new Date(date.getFullYear(), 8, 23),
            dateTo: new Date(date.getFullYear(), 9, 22),
        };
    }
    if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) {
        return {
            name: "scorpio",
            dateFrom: new Date(date.getFullYear(), 9, 23),
            dateTo: new Date(date.getFullYear(), 10, 21),
        };
    }
    if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) {
        return {
            name: "sagittarius",
            dateFrom: new Date(date.getFullYear(), 10, 22),
            dateTo: new Date(date.getFullYear(), 11, 21),
        };
    }
    if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) {
        return {
            name: "capricorn",
            dateFrom: new Date(date.getFullYear(), 11, 22),
            dateTo: new Date(date.getFullYear(), 0, 19),
        };
    }
    if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) {
        return {
            name: "aquarius",
            dateFrom: new Date(date.getFullYear(), 0, 20),
            dateTo: new Date(date.getFullYear(), 1, 18),
        };
    }
    return {
        name: "pisces",
        dateFrom: new Date(date.getFullYear(), 1, 19),
        dateTo: new Date(date.getFullYear(), 2, 20),
    };
}
