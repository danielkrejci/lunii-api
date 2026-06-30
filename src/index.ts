import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import autoLoad from "@fastify/autoload";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import { fastifySchedule } from "@fastify/schedule";
import Fastify from "fastify";
import {
    hasZodFastifySchemaValidationErrors,
    isResponseSerializationError,
    serializerCompiler,
    validatorCompiler,
    ZodTypeProvider,
} from "fastify-type-provider-zod";

import { createTransitJob, executeTransitsGeneration } from "./modules/transits";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
                          },
                      },
                  ],
              },
          }
        : true,
}).withTypeProvider<ZodTypeProvider>();

// Configure CORS
fastify.register(cors, {
    origin: true,
    credentials: true,
});

// Add schema validator and serializer
fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

fastify.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
        return reply.status(400).send({
            error: {
                message: error.validation[0].message,
            },
        });
    }

    if (isResponseSerializationError(error)) {
        return reply.status(500).send({
            error: {
                message: "Internal Server Error",
            },
        });
    }

    reply.send(error);
});

fastify.register(formbody);

fastify.register(multipart);

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

fastify.ready(async (err) => {
    if (err) {
        console.error("Fastify failed to load:", err);
        process.exit(1);
    }

    // create transit job
    const job = createTransitJob(fastify.db);

    // add cron job
    fastify.scheduler.addCronJob(job);

    // immediate run
    await executeTransitsGeneration(fastify.db);

    // print available routes
    console.log(fastify.printRoutes());
});

try {
    await fastify.listen({ port: Number(process.env.PORT || 3000), host: "0.0.0.0" });
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}
