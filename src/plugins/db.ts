import fp from "fastify-plugin";

import { db, pool } from "../db";
import { DRAIN_TIMEOUT_MS, drainBackgroundTasks, runningBackgroundTasks } from "../lib/backgroundTasks";

export default fp(
    async function fastifyDb(fastify) {
        if (fastify.db) {
            return;
        }

        try {
            fastify.decorate("db", db);

            fastify.addHook("onClose", async (fastifyInstance) => {
                if (fastifyInstance.db) {
                    /**
                     * The HTTP server has closed by now — Fastify closes it before any
                     * plugin's hook runs — so no request is left to start new work. What
                     * is already running still has to write its result, so it gets the
                     * pool until it is done.
                     */
                    if (runningBackgroundTasks() > 0) {
                        fastifyInstance.log.info(
                            { tasks: runningBackgroundTasks() },
                            "Waiting for background tasks before closing the db..."
                        );

                        const left = await drainBackgroundTasks(DRAIN_TIMEOUT_MS);

                        if (left > 0) {
                            fastifyInstance.log.warn({ tasks: left }, "Background tasks still running, closing anyway");
                        } else {
                            fastifyInstance.log.info("Background tasks drained.");
                        }
                    }

                    fastifyInstance.log.info("Closing db connection...");

                    await pool.end();

                    fastifyInstance.log.info("DB connection closed.");
                }
            });
        } catch (error) {
            fastify.log.error(`Failed to establish db connection.`);

            throw error;
        }
    },
    {
        name: "db",
    }
);
