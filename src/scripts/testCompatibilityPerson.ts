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
import { desc, eq } from "drizzle-orm";

import { db } from "../db";
import { compatibilityPeople, profile, transit } from "../db/schema";
import { calculateCompatibility, calculateDailyCompatibility } from "../modules/compatibilityPeople/aspects";
import { BASE_NORMALIZER, normalizeScore, OVERALL_NORMALIZER } from "../modules/compatibilityPeople/normalizer";
import { takeUniqueOrThrow } from "../utils/drizzleUtils";

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

async function main() {
    const sourcePerson = await db
        .select({
            id: profile.id,
            name: profile.name,
            gender: profile.gender,
            relationship: profile.relationshipStatus,
            birthDate: profile.birthDate,
            birthTime: profile.birthTime,
            birthPlace: profile.birthPlace,
            birthPlaceLat: profile.birthPlaceLat,
            birthPlaceLng: profile.birthPlaceLng,
            sign: profile.sunSign,
            birthChart: profile.birthChart,
        })
        .from(profile)
        .where(eq(profile.id, "ca2e9477-8fa2-468f-b15a-6a4ccd105fa0"))
        .then(takeUniqueOrThrow);

    const tagetPerson = await db
        .select({
            id: compatibilityPeople.id,
            name: compatibilityPeople.name,
            gender: compatibilityPeople.gender,
            relationship: compatibilityPeople.relationship,
            birthDate: compatibilityPeople.birthDate,
            birthTime: compatibilityPeople.birthTime,
            birthPlace: compatibilityPeople.birthPlace,
            birthPlaceLat: compatibilityPeople.birthPlaceLat,
            birthPlaceLng: compatibilityPeople.birthPlaceLng,
            sign: compatibilityPeople.sunSign,
            image: compatibilityPeople.image,
            birthChart: compatibilityPeople.birthChart,
        })
        .from(compatibilityPeople)
        .where(eq(compatibilityPeople.id, "22faf6c3-76a6-4097-9777-9dd3233d6665"))
        .then(takeUniqueOrThrow);

    const transits = await db.select().from(transit).orderBy(desc(transit.date));

    let count = 0;

    for (const { date, planets } of transits) {
        console.log("test idx: ", count);
        console.log("date:", dayjs(date).format("YYYY-MM-DD"));

        const userNatalChart = sourcePerson.birthChart;
        const partnerNatalChart = tagetPerson.birthChart;

        const compatibility = calculateCompatibility(userNatalChart, partnerNatalChart);

        const dailyCompatibility = calculateDailyCompatibility(planets, userNatalChart, partnerNatalChart);

        const overallRaw = compatibility.overall + dailyCompatibility.modifier;

        const baseScore = normalizeScore(compatibility.overall, BASE_NORMALIZER);
        const overallScore = normalizeScore(overallRaw, OVERALL_NORMALIZER);

        console.log({
            date: dayjs(date).format("YYYY-MM-DD"),
            // partnerPositive: dailyCompatibility.partnerPositive,
            // partnerNegative: dailyCompatibility.partnerNegative,
            // userPositive: dailyCompatibility.userPositive,
            // userNegative: dailyCompatibility.userNegative,
            // overall: compatibility.overall,
            // modifier: dailyCompatibility.modifier,
            baseScore,
            overallScore,
        });
        console.log("==========================");

        count++;
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
