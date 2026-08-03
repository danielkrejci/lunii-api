import { scoreAspect, scoreTransitAspect } from "./scoring";
import { NatalChart, TransitChart } from "./types";
import {
    aggregateScore,
    buildRelationshipBreakdown,
    buildTransitBreakdown,
    calculateSynastryAspects,
    calculateTransitAspects,
    findPositiveAspects,
    findNegativeAspects,
    selectTopAspects,
} from "./utils";

export function calculateCompatibility(chartA: NatalChart, chartB: NatalChart) {
    // Find aspects
    const aspects = calculateSynastryAspects(chartA, chartB);

    // Score aspects
    const scored = aspects.map((aspect) => scoreAspect(aspect)).filter((a) => a !== null);

    // Aggregate score
    const { positive, negative, overall } = aggregateScore(scored);

    return {
        positive,
        negative,
        overall,
        breakdown: buildRelationshipBreakdown(scored),
        breakdownRaw: buildRelationshipBreakdown(scored),
        positiveAspects: findPositiveAspects(scored),
        negativeAspects: findNegativeAspects(scored),
        aspects: scored,
    };
}

export function calculateDailyCompatibility(
    transits: TransitChart,
    userNatalChart: NatalChart,
    partnerNatalChart: NatalChart
) {
    //
    // USER TRANSITS → PARTNER NATAL
    //
    const userTransitAspects = calculateTransitAspects(transits, partnerNatalChart);

    const userScored = userTransitAspects
        .map((aspect) => scoreTransitAspect(aspect))
        .filter((aspect) => aspect !== null);

    const userTop = selectTopAspects(userScored);

    const userTotals = aggregateScore(userTop);

    //
    // PARTNER TRANSITS → USER NATAL
    //
    const partnerTransitAspects = calculateTransitAspects(transits, userNatalChart);

    const partnerScored = partnerTransitAspects.map((aspect) => scoreTransitAspect(aspect)).filter((a) => a !== null);

    const partnerTop = selectTopAspects(partnerScored);

    const partnerTotals = aggregateScore(partnerTop);

    //
    // FINAL
    //
    const userModifier = userTotals.overall;

    const partnerModifier = partnerTotals.overall;

    const modifier = userModifier * 0.5 + partnerModifier * 0.5;

    const allAspects = [...userTop, ...partnerTop];

    const positiveAspects = findPositiveAspects(allAspects);
    const negativeAspects = findNegativeAspects(allAspects);

    const positiveOverall = positiveAspects.reduce((sum, a) => sum + a.positive, 0);
    const negativeOverall = negativeAspects.reduce((sum, a) => sum + a.negative, 0);

    return {
        modifier,

        userModifier,
        partnerModifier,

        userPositive: userTotals.positive,
        userNegative: userTotals.negative,

        partnerPositive: partnerTotals.positive,
        partnerNegative: partnerTotals.negative,

        positiveOverall,
        negativeOverall,

        positiveAspects,
        negativeAspects,

        userBreakdown: buildTransitBreakdown(userTop),
        partnerBreakdown: buildTransitBreakdown(partnerTop),
        overallBreakdown: buildTransitBreakdown(allAspects),

        userAspects: userTop,
        partnerAspects: partnerTop,
    };
}
