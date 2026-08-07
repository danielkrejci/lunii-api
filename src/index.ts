import { createRequire } from "node:module";
import { join } from "node:path";

import autoLoad from "@fastify/autoload";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import { fastifySchedule } from "@fastify/schedule";
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
import Fastify from "fastify";
import {
    hasZodFastifySchemaValidationErrors,
    isResponseSerializationError,
    serializerCompiler,
    validatorCompiler,
    ZodTypeProvider,
} from "fastify-type-provider-zod";

import { MAX_IMAGE_SIZE } from "./lib/r2";
import {
    createDailyScoresJob,
    createStuckGenerationsJob,
    executeDailyScoresGeneration,
} from "./modules/dailyScore/service";
import { createTransitJob, executeTransitsGeneration } from "./modules/transits";

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

// oxlint-disable-next-line no-underscore-dangle
const __dirname = import.meta.dirname;

const require = createRequire(import.meta.url);

const isDev = process.env.NODE_ENV !== "production";

const fastify = Fastify({
    pluginTimeout: 60000,
    logger: isDev
        ? {
              level: "debug",
              transport: {
                  targets: [
                      {
                          target: require.resolve("pino-pretty"),
                          options: {
                              colorize: true,
                              translateTime: "SYS:standard",
                              ignore: "pid,hostname",
                              singleLine: true,
                          },
                      },
                  ],
              },
          }
        : true,
}).withTypeProvider<ZodTypeProvider>();

// Configure CORS
fastify.register(cors, {
    origin: ["https://api.getlunii.com", "https://api-dev.getlunii.com"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "User-Agent"],
    methods: ["POST", "GET", "OPTIONS", "PUT", "DELETE", "PATCH"],
    credentials: true,
});

// Add schema validator and serializer
fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

// Cloudflare injects __cf_bm (and similar) as a separate Cookie header. Node
// then joins multiple Cookie headers with ",", which better-auth's parser
// can't read — only "; " is recognized. Normalize before any route handler
// or auth.api.getSession() runs.
fastify.addHook("onRequest", async (request) => {
    const cookie = request.headers.cookie;
    if (cookie && /,\s*[A-Za-z_]/.test(cookie)) {
        request.headers.cookie = cookie.replaceAll(/,\s*(?=[A-Za-z_])/g, "; ");
    }
});

fastify.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
        return reply.status(400).send({
            error: {
                code: "validation_error",
                message: error.validation[0].message,
            },
        });
    }

    if (isResponseSerializationError(error)) {
        request.log.error(
            { err: error, method: error.method, url: error.url, cause: error.cause },
            "Response serialization error"
        );
        return reply.status(500).send({
            error: {
                code: "internal_server_error",
                message: "Internal Server Error",
            },
        });
    }

    request.log.error({ err: error }, "Unhandled request error");

    reply.send(error);
});

fastify.register(formbody);

fastify.register(multipart, {
    limits: {
        fileSize: MAX_IMAGE_SIZE,
    },
});

fastify.register(fastifySchedule);

fastify.register(autoLoad, {
    dir: join(__dirname, "plugins"),
});

fastify.register(autoLoad, {
    dir: join(__dirname, "routes"),
    options: {
        prefix: "/api",
    },
});

fastify.get("/", (_, reply) => {
    reply.redirect("https://getlunii.com");
});

fastify.ready(async (err) => {
    if (err) {
        console.error("Fastify failed to load:", err);
        process.exit(1);
    }

    // create transit job
    const job = createTransitJob(fastify.db);

    // add cron jobs
    fastify.scheduler.addCronJob(job);
    fastify.scheduler.addCronJob(createDailyScoresJob(fastify.db));
    fastify.scheduler.addCronJob(createStuckGenerationsJob(fastify.db));

    // immediate run: transits first, then tomorrow's scores for everyone
    await executeTransitsGeneration(fastify.db);
    await executeDailyScoresGeneration(fastify.db);

    // print available routes
    console.log(fastify.printRoutes());
});

try {
    await fastify.listen({ port: Number(process.env.PORT || 3000), host: "0.0.0.0" });
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}
