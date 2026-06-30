export const signs = [
    "aries",
    "taurus",
    "gemini",
    "cancer",
    "leo",
    "virgo",
    "libra",
    "scorpio",
    "sagittarius",
    "capricorn",
    "aquarius",
    "pisces",
];

export function getAngleDiff(a: number, b: number) {
    let diff = Math.abs(a - b);
    if (diff > 180) diff = 360 - diff;
    return diff;
}

export function getAspect(diff: number) {
    const orb = 6; // tolerance

    if (Math.abs(diff - 0) < orb) return "conjunction";
    if (Math.abs(diff - 60) < orb) return "sextile";
    if (Math.abs(diff - 90) < orb) return "square";
    if (Math.abs(diff - 120) < orb) return "trine";
    if (Math.abs(diff - 180) < orb) return "opposition";

    return null;
}

export function getExactAngle(type: string) {
    switch (type) {
        case "conjunction":
            return 0;
        case "sextile":
            return 60;
        case "square":
            return 90;
        case "trine":
            return 120;
        case "opposition":
            return 180;
        default:
            return 0;
    }
}
