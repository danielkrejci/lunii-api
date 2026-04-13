import { createEnv } from "@t3-oss/env-nextjs";
import { config } from "dotenv";
import { z } from "zod";

config({ path: ".env.local", override: true });

export const env = createEnv({
    server: {
        // Postgres
        POSTGRES_URL: z.url(),

        // Better Auth
        BETTER_AUTH_SECRET: z.string().min(1),
        BETTER_AUTH_URL: z.url(),

        // Placekit
        PLACEKIT_API_KEY: z.string().min(1),

        // Google AI
        GEMINI_API_KEY: z.string().min(1),
    },
    client: {},
    experimental__runtimeEnv: {},
});
