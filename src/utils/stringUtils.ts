export function parseLLMJson<T>(text: string): T | null {
    try {
        const cleaned = text.replaceAll("```json", "").replaceAll("```", "").trim();

        return JSON.parse(cleaned);
    } catch (err) {
        console.error("Failed to parse JSON:", err);
        return null;
    }
}

export function getLLMJson(text: string): string {
    return text.replaceAll("```json", "").replaceAll("```", "").trim();
}
