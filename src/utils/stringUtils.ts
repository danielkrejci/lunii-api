export function parseLLMJson<T>(text: string): T | null {
    try {
        const cleaned = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        return JSON.parse(cleaned);
    } catch (err) {
        console.error("Failed to parse JSON:", err);
        return null;
    }
}
