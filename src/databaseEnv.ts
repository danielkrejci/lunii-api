import { createEnv } from "@t3-oss/env-nextjs";
import { config } from "dotenv";
import { z } from "zod";

config({ path: ".env.local", override: true });

/**
 * The one variable the database needs, validated on its own.
 *
 * The migrations run as an App Platform pre-deploy job that is given only the database
 * URL. Importing the full `env` there would fail on every API key the job has no use
 * for, so `migrate.ts` reads this and `env` extends it.
 */
export const databaseEnv = createEnv({
    server: {
        POSTGRES_URL: z.url(),
    },
    client: {},
    experimental__runtimeEnv: {},
});
