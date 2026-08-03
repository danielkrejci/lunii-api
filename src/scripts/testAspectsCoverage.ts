import { NatalChart } from "../modules/compatibilityPeople/types";
import { calculateSynastryAspects, getRelationshipRule } from "../modules/compatibilityPeople/utils";

const BASE_BIRTH_CHART = {
    sun: { sign: "pisces", speed: 0.997704668257512, longitude: 351.6661162467737, signIndex: 11, retrograde: false },
    mars: { sign: "aries", speed: 0.7704845057400631, longitude: 6.013337970776682, signIndex: 0, retrograde: false },
    moon: { sign: "virgo", speed: 11.925364831957154, longitude: 163.6871307573644, signIndex: 5, retrograde: false },
    pluto: {
        sign: "sagittarius",
        speed: -0.0007259517876307295,
        longitude: 248.0629540855715,
        signIndex: 8,
        retrograde: true,
    },
    venus: {
        sign: "aquarius",
        speed: 0.8508147218251412,
        longitude: 306.22638239684807,
        signIndex: 10,
        retrograde: false,
    },
    saturn: {
        sign: "aries",
        speed: 0.1170558672751678,
        longitude: 19.390126855092003,
        signIndex: 0,
        retrograde: false,
    },
    uranus: {
        sign: "aquarius",
        speed: 0.04764392771624145,
        longitude: 311.042359133531,
        signIndex: 10,
        retrograde: false,
    },
    jupiter: {
        sign: "pisces",
        speed: 0.2377797959723962,
        longitude: 338.63266872692134,
        signIndex: 11,
        retrograde: false,
    },
    mercury: {
        sign: "aries",
        speed: 1.6708244422004175,
        longitude: 7.2717106890146965,
        signIndex: 0,
        retrograde: false,
    },
    neptune: {
        sign: "aquarius",
        speed: 0.026900925027224982,
        longitude: 301.4155018903624,
        signIndex: 10,
        retrograde: false,
    },
};
const BIRTH_CHART_1 = {
    sun: { sign: "taurus", speed: 0.965494670188126, longitude: 51.8548291409059, signIndex: 1, retrograde: false },
    mars: { sign: "cancer", speed: 0.6334134687672345, longitude: 93.10111946650096, signIndex: 3, retrograde: false },
    moon: {
        sign: "pisces",
        speed: 13.376722408674814,
        longitude: 331.86157625786143,
        signIndex: 11,
        retrograde: false,
    },
    venus: { sign: "gemini", speed: 0.20981099599267153, longitude: 85.5301897857089, signIndex: 2, retrograde: false },
    saturn: {
        sign: "cancer",
        speed: 0.10093629353853725,
        longitude: 99.92298103323795,
        signIndex: 3,
        retrograde: false,
    },
    jupiter: {
        sign: "virgo",
        speed: 0.0215063830374341,
        longitude: 158.99171031270865,
        signIndex: 5,
        retrograde: false,
    },
    mercury: {
        sign: "aries",
        speed: 0.8243805132132211,
        longitude: 26.235159449915198,
        signIndex: 0,
        retrograde: false,
    },
};
// const BIRTH_CHART_2 = {
//     sun: { sign: "libra", speed: 0.9821008914594589, longitude: 185.6478886327111, signIndex: 6, retrograde: false },
//     mars: { sign: "libra", speed: 0.6704366003034792, longitude: 206.11411843396812, signIndex: 6, retrograde: false },
//     moon: { sign: "virgo", speed: 13.13674328574926, longitude: 174.4957044883822, signIndex: 5, retrograde: false },
//     venus: {
//         sign: "scorpio",
//         speed: 1.219954086033492,
//         longitude: 215.23874358193868,
//         signIndex: 7,
//         retrograde: false,
//     },
//     saturn: {
//         sign: "virgo",
//         speed: 0.12072788102889159,
//         longitude: 164.94290223016844,
//         signIndex: 5,
//         retrograde: false,
//     },
//     jupiter: {
//         sign: "capricorn",
//         speed: 0.06316276520612091,
//         longitude: 283.1796252509592,
//         signIndex: 9,
//         retrograde: false,
//     },
//     mercury: {
//         sign: "libra",
//         speed: -0.4943360242312537,
//         longitude: 201.84164157139134,
//         signIndex: 6,
//         retrograde: true,
//     },
// };

async function main() {
    const aspects = calculateSynastryAspects(BASE_BIRTH_CHART as NatalChart, BIRTH_CHART_1 as NatalChart);

    let total = 0;
    let matched = 0;

    for (const aspect of aspects) {
        total++;

        if (getRelationshipRule([aspect.planetA, aspect.planetB], aspect.aspect)) {
            matched++;
        }
    }

    console.log({
        total,
        matched,
        coverage: matched / total,
    });
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
