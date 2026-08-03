import dayjs from "dayjs";

import { db } from "../db";
import { transit } from "../db/schema";
import { computeTransits } from "../modules/transits";

async function main() {
    const DAYS = 180;
    const START_DATE = dayjs()
        .utc()
        .subtract(Math.floor(DAYS / 2), "day");
    const END_DATE = START_DATE.add(DAYS, "day");

    console.log("Starting date:", START_DATE.format("YYYY-MM-DD"));
    console.log("Ending date:", END_DATE.format("YYYY-MM-DD"));
    console.log("Total days:", DAYS);

    console.log("Seeding transits table...");

    for (let i = 0; i < DAYS; i++) {
        const date = START_DATE.startOf("day").add(i, "day").toDate();

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

    console.log("Done!");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
