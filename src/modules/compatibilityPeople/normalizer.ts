import { NormalizerConfig } from "./types";

export const BASE_NORMALIZER = {
    median: 14.3,
    sigma: 27,
};

export const OVERALL_NORMALIZER = {
    median: 21.3,
    sigma: 31,
};

export function normalizeScore(raw: number, config: NormalizerConfig): number {
    const { median, sigma } = config;

    const normalized = 100 / (1 + Math.exp(-(raw - median) / sigma));

    return Math.round(Math.max(0, Math.min(100, normalized)));
}
