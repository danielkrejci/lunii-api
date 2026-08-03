import { RELATIONSHIP_RULES, TRANSIT_RULES } from "../modules/compatibilityPeople/rules";

async function main() {
    console.log("======= RELATIONSHIP_RULES =======");
    console.table(
        RELATIONSHIP_RULES.map((rule) => ({
            title: rule.title,
            impact: rule.impact,
            importance: rule.importance,
            maxScore: Math.abs(rule.impact) * rule.importance,
        })).sort((a, b) => b.maxScore - a.maxScore)
    );
    console.log("======= TRANSIT_RULES =======");
    console.table(
        TRANSIT_RULES.map((rule) => ({
            title: rule.title,
            impact: rule.impact,
            importance: rule.importance,
            maxScore: Math.abs(rule.impact) * rule.importance,
        })).sort((a, b) => b.maxScore - a.maxScore)
    );
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
