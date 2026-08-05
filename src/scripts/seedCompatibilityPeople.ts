import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import isToday from "dayjs/plugin/isToday";
import isTomorrow from "dayjs/plugin/isTomorrow";
import isYesterday from "dayjs/plugin/isYesterday";
import minMax from "dayjs/plugin/minMax";
import timezone from "dayjs/plugin/timezone";
import updateLocale from "dayjs/plugin/updateLocale";
import utc from "dayjs/plugin/utc";
import weekOfYear from "dayjs/plugin/weekOfYear";

import { db } from "../db";
import { compatibilityPeople } from "../db/schema";
import { computeNatalChart } from "../modules/astro";
import { calculateCompatibility } from "../modules/compatibilityPeople/aspects";
import { BASE_NORMALIZER, normalizeScore } from "../modules/compatibilityPeople/normalizer";
import { Gender, Relationship } from "../utils/natalUtils";

dayjs.extend(utc);
dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);
dayjs.extend(timezone);
dayjs.extend(isToday);
dayjs.extend(isTomorrow);
dayjs.extend(isYesterday);
dayjs.extend(minMax);
dayjs.extend(updateLocale);
dayjs.extend(isSameOrBefore);

const FIRST_NAMES_MALE = ["Jan", "Petr", "Martin", "Tomáš", "David", "Filip", "Jakub", "Lukáš"];

const FIRST_NAMES_FEMALE = ["Anna", "Eva", "Lucie", "Kateřina", "Tereza", "Petra", "Jana", "Kristýna"];

const CITIES = [
    {
        name: "Prague",
        lat: 50.0755,
        lng: 14.4378,
        timezone: "Europe/Prague",
    },
    {
        name: "Brno",
        lat: 49.1951,
        lng: 16.6068,
        timezone: "Europe/Prague",
    },
    {
        name: "Vienna",
        lat: 48.2082,
        lng: 16.3738,
        timezone: "Europe/Vienna",
    },
    {
        name: "Berlin",
        lat: 52.52,
        lng: 13.405,
        timezone: "Europe/Berlin",
    },
    {
        name: "London",
        lat: 51.5072,
        lng: -0.1276,
        timezone: "Europe/London",
    },
    {
        name: "New York",
        lat: 40.7128,
        lng: -74.006,
        timezone: "America/New_York",
    },
    {
        name: "Los Angeles",
        lat: 34.0522,
        lng: -118.2437,
        timezone: "America/Los_Angeles",
    },
    {
        name: "Tokyo",
        lat: 35.6762,
        lng: 139.6503,
        timezone: "Asia/Tokyo",
    },
];

const BIRTH_CHART = {
    sun: { sign: "pisces", speed: 0.997704668257512, longitude: 351.6661162467737, signIndex: 11, retrograde: false },
    mars: { sign: "aries", speed: 0.7704845057400631, longitude: 6.013337970776682, signIndex: 0, retrograde: false },
    moon: { sign: "virgo", speed: 11.925364831957154, longitude: 163.6871307573644, signIndex: 5, retrograde: false },
    pluto: {
        sign: "sagittarius",
        speed: -0.0007259517876307295,
        longitude: 248.0629540855715,
        signIndex: 8,
        retrograde: true,
    },
    venus: {
        sign: "aquarius",
        speed: 0.8508147218251412,
        longitude: 306.22638239684807,
        signIndex: 10,
        retrograde: false,
    },
    saturn: {
        sign: "aries",
        speed: 0.1170558672751678,
        longitude: 19.390126855092003,
        signIndex: 0,
        retrograde: false,
    },
    uranus: {
        sign: "aquarius",
        speed: 0.04764392771624145,
        longitude: 311.042359133531,
        signIndex: 10,
        retrograde: false,
    },
    jupiter: {
        sign: "pisces",
        speed: 0.2377797959723962,
        longitude: 338.63266872692134,
        signIndex: 11,
        retrograde: false,
    },
    mercury: {
        sign: "aries",
        speed: 1.6708244422004175,
        longitude: 7.2717106890146965,
        signIndex: 0,
        retrograde: false,
    },
    neptune: {
        sign: "aquarius",
        speed: 0.026900925027224982,
        longitude: 301.4155018903624,
        signIndex: 10,
        retrograde: false,
    },
};

function randomItem<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

function randomDate(startYear = 1950, endYear = 2010): Date {
    const start = new Date(startYear, 0, 1).getTime();
    const end = new Date(endYear, 11, 31).getTime();

    return new Date(start + Math.random() * (end - start));
}

async function createPerson(userId: string) {
    const gender = Math.random() < 0.5 ? "male" : ("female" as Gender);

    const name = gender === "male" ? randomItem(FIRST_NAMES_MALE) : randomItem(FIRST_NAMES_FEMALE);

    const city = randomItem(CITIES);

    const birthDate = dayjs(randomDate());
    const birthTime = dayjs(birthDate);

    const { chart: birthChart } = computeNatalChart({
        birthDate: birthDate.format("YYYY-MM-DD"),
        birthTime: birthTime.format("HH:mm"),
        birthPlaceLat: city.lat,
        birthPlaceLng: city.lng,
        timezone: city.timezone,
    });

    const risingSign = birthChart.ascendant?.sign ?? null;

    const baseCompatibility = calculateCompatibility(BIRTH_CHART as any, birthChart);

    const baseScore = normalizeScore(baseCompatibility.overall, BASE_NORMALIZER);

    return {
        id: crypto.randomUUID(),
        userId,
        name,
        gender,
        relationship: "partner" as Relationship,
        birthDate: birthDate.format("YYYY-MM-DD"),
        birthTime: birthTime.format("HH:mm"),
        birthPlace: city.name,
        birthPlaceLat: city.lat,
        birthPlaceLng: city.lng,
        timezone: city.timezone,
        sunSign: birthChart.sun.sign,
        moonSign: birthChart.moon.sign,
        risingSign: risingSign,
        birthChart: birthChart,
        baseCompatibility,
        baseScore,
    };
}

const USER_IDS = [
    "Q1a2B4klV7GLduDOZ2u8wUEfAuuLteyS",
    "yngxurNGnOTOQiqwwaivdsL3A4M10Pf2",
    "cC1g7nlYbrXG2vT0YkgST5eemoCnmaPe",
];

async function main() {
    const COUNT = Number(process.argv[2] ?? 1000);

    const rows = [];

    for (let i = 0; i < COUNT; i++) {
        const userId = USER_IDS[Math.floor(Math.random() * USER_IDS.length)];

        rows.push(await createPerson(userId));

        if (i % 100 === 0) {
            console.log(`Generated ${i}`);
        }
    }

    await db.insert(compatibilityPeople).values(rows);

    console.log(`Inserted ${COUNT} people`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
