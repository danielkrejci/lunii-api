import placekit from "@placekit/client-js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { env } from "../../env";
import { serializeDrizzleData } from "../../utils/drizzleUtils";

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/search",
        {
            schema: {
                body: z.object({
                    query: z.string().min(1, "Query is required"),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            results: z.array(
                                z.object({
                                    name: z.string(),
                                    highlight: z.string(),
                                    county: z.string(),
                                    country: z.string(),
                                    countryCode: z.string(),
                                    lat: z.number(),
                                    lng: z.number(),
                                })
                            ),
                            resultsCount: z.number(),
                            maxResults: z.number(),
                            query: z.string(),
                        }),
                    }),
                    400: z.object({
                        error: z.object({
                            message: z.string(),
                        }),
                    }),
                    401: z.object({
                        error: z.object({
                            message: z.string(),
                        }),
                    }),
                },
            },
        },
        async (request, reply) => {
            // return reply.status(200).send({
            //     data: {
            //         results: [
            //             {
            //                 name: "Hradec Králové",
            //                 highlight: "<mark>Hradec Králov</mark>é",
            //                 city: "Hradec Králové",
            //                 county: "okres Hradec Králové",
            //                 administrative: "Severovýchod",
            //                 country: "Česko",
            //                 administrativecode: "",
            //                 countrycode: "cz",
            //                 countycode: "",
            //                 zipcode: ["500 02"],
            //                 population: 92809,
            //                 lat: 50.2094963,
            //                 lng: 15.832719,
            //                 coordinates: "50.2094963, 15.832719",
            //                 type: "city",
            //             },
            //             {
            //                 name: "Hade",
            //                 highlight: "<mark>Hade</mark>",
            //                 city: "Hade",
            //                 county: "Komuna e Obiliqit",
            //                 administrative: "Pristina",
            //                 country: "Kosovo",
            //                 administrativecode: "",
            //                 countrycode: "xk",
            //                 countycode: "",
            //                 zipcode: [],
            //                 population: 500,
            //                 lat: 42.66679,
            //                 lng: 21.03298,
            //                 coordinates: "42.66679, 21.03298",
            //                 type: "city",
            //             },
            //             {
            //                 name: "Hade e Re",
            //                 highlight: "<mark>Hade</mark> e Re",
            //                 city: "Hade e Re",
            //                 county: "",
            //                 administrative: "Pristina",
            //                 country: "Kosovo",
            //                 administrativecode: "",
            //                 countrycode: "xk",
            //                 countycode: "",
            //                 zipcode: [],
            //                 population: 150,
            //                 lat: 42.67906,
            //                 lng: 21.12636,
            //                 coordinates: "42.67906, 21.12636",
            //                 type: "city",
            //             },
            //             {
            //                 name: "Slovenj Gradec",
            //                 highlight: "<mark>Slov</mark>enj <mark>Gradec</mark>",
            //                 city: "Slovenj Gradec",
            //                 county: "",
            //                 administrative: "Koroška",
            //                 country: "Slovenija",
            //                 administrativecode: "",
            //                 countrycode: "si",
            //                 countycode: "",
            //                 zipcode: ["2380"],
            //                 population: 7500,
            //                 lat: 46.509144,
            //                 lng: 15.0790677,
            //                 coordinates: "46.509144, 15.0790677",
            //                 type: "city",
            //             },
            //             {
            //                 name: "Šmartno pri Slovenj Gradcu",
            //                 highlight: "Šmartno pri <mark>Slov</mark>enj Gradcu",
            //                 city: "Šmartno pri Slovenj Gradcu",
            //                 county: "",
            //                 administrative: "Slovenj Gradec",
            //                 country: "Slovenija",
            //                 administrativecode: "",
            //                 countrycode: "si",
            //                 countycode: "",
            //                 zipcode: ["2383"],
            //                 population: 1250,
            //                 lat: 46.48944,
            //                 lng: 15.10667,
            //                 coordinates: "46.48944, 15.10667",
            //                 type: "city",
            //             },
            //         ],
            //         resultsCount: 5,
            //         maxResults: 5,
            //         query: "hradec krslov",
            //     },
            // });

            const pk = placekit(env.PLACEKIT_API_KEY);

            try {
                const { results, maxResults, query } = await pk.search(request.body.query, {
                    types: ["city"],
                    maxResults: 20,
                });

                const filteredResults = results.filter((item) => item.lat !== undefined && item.lng !== undefined);

                return reply.status(200).send({
                    data: serializeDrizzleData({
                        results: filteredResults.map((r) => ({
                            name: r.name,
                            highlight: r.highlight,
                            county: r.county,
                            country: r.country,
                            countryCode: r.countrycode,
                            lat: r.lat!,
                            lng: r.lng!,
                        })),
                        resultsCount: filteredResults.length,
                        maxResults,
                        query,
                    }),
                });
            } catch (e: any) {
                return reply.status(400).send({
                    error: {
                        message: "detail" in e ? e.detail : "message" in e ? e.message : "Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
