import { appendFile } from "node:fs/promises";

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
import { desc } from "drizzle-orm";

import { db } from "../db";
import { compatibilityPeople, transit } from "../db/schema";
import { calculateCompatibility, calculateDailyCompatibility } from "../modules/compatibilityPeople/aspects";
import { normalizeScore, OVERALL_NORMALIZER } from "../modules/compatibilityPeople/normalizer";

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
    const people = await db
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
        .from(compatibilityPeople);

    const transits = await db.select().from(transit).orderBy(desc(transit.date)).limit(10);

    let count = 0;

    for (const person of people) {
        const restPeople = people.filter((i) => i.id !== person.id);

        const sourcePerson = person;
        const tagetPerson = restPeople.filter((i) => i.id !== sourcePerson.id)[
            Math.floor(Math.random() * restPeople.length)
        ];

        const { date, planets } = transits[Math.floor(Math.random() * transits.length)];

        console.log("test idx: ", count);
        console.log("date:", dayjs(date).format("YYYY-MM-DD"));

        const result: any = {
            idx: count,
            date: dayjs(date).format("YYYY-MM-DD"),
            tests: [],
        };

        [
            [sourcePerson, tagetPerson],
            [tagetPerson, sourcePerson],
        ].forEach(([a, b]) => {
            console.log("sourcePerson.id", a.id);
            console.log("targetPerson.id", b.id);

            const userNatalChart = a.birthChart;
            const partnerNatalChart = b.birthChart;

            const compatibility = calculateCompatibility(userNatalChart, partnerNatalChart);

            const dailyCompatibility = calculateDailyCompatibility(planets, userNatalChart, partnerNatalChart);

            const overallRaw = compatibility.overall + dailyCompatibility.modifier;

            // const baseScore = normalizeScore(compatibility.overall, BASE_NORMALIZER);
            const overallScore = normalizeScore(overallRaw, OVERALL_NORMALIZER);

            // console.log("compatibility today:", compatibilityToday);
            // console.log({
            //     partnerPositiveRaw: dailyCompatibility.partnerPositiveRaw,
            //     partnerNegativeRaw: dailyCompatibility.partnerNegativeRaw,
            //     userPositiveRaw: dailyCompatibility.userPositiveRaw,
            //     userNegativeRaw: dailyCompatibility.userNegativeRaw,
            //     overallRaw: compatibility.overallRaw,
            //     modifier: dailyCompatibility.modifier,
            // });
            // console.log("===");

            result.tests.push({
                sourcePersonId: a.id,
                targetPersonId: b.id,
                positive: compatibility.positive,
                negative: compatibility.negative,
                overall: compatibility.overall,
                aspectCount: compatibility.aspects.length,
                modifier: dailyCompatibility.modifier,
                overallScore: overallScore,
                positiveAspects: compatibility.positiveAspects,
                negativeAspects: compatibility.negativeAspects,
                // partnerPositive: dailyCompatibility.partnerPositive,
                // partnerNegative: dailyCompatibility.partnerNegative,
                // userPositive: dailyCompatibility.userPositive,
                // userNegative: dailyCompatibility.userNegative,
                // overall: compatibility.overall,
                // modifier: dailyCompatibility.modifier,
                // baseScore,
                // overallScore,
            });
        });

        console.log("==========================");

        await appendFile("benchmark.ndjson", JSON.stringify(result) + "\n");

        count++;
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
