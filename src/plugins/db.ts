import fp from "fastify-plugin";
import { db, pool } from "../db";

export default fp(
    async function fastifyDb(fastify) {
        if (fastify.db) {
            return;
        }

        try {
            fastify.decorate("db", db);

            fastify.addHook("onClose", async (fastifyInstance) => {
                if (fastifyInstance.db) {
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
