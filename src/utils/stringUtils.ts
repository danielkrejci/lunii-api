export function parseLLMJson<T>(text: string): T | null {
    const cleaned = getLLMJson(text);

    try {
        return JSON.parse(cleaned);
    } catch {
        // LLMs sometimes emit literal newlines/tabs inside string values (typically in
        // long multi-paragraph fields), which is invalid JSON. Escape them and retry.
        try {
            return JSON.parse(escapeControlCharsInStrings(cleaned));
        } catch (err) {
            console.error("Failed to parse JSON:", err);
            return null;
        }
    }
}

export function getLLMJson(text: string): string {
    const cleaned = text.replaceAll("```json", "").replaceAll("```", "").trim();

    // Drop any prose the model added before/after the JSON payload.
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));

    if (start === -1 || end <= start) {
        return cleaned;
    }

    return cleaned.slice(start, end + 1);
}

/**
 * Escapes raw control characters that appear inside JSON string literals,
 * leaving the structural whitespace between tokens untouched.
 */
function escapeControlCharsInStrings(json: string): string {
    let result = "";
    let inString = false;
    let escaped = false;

    for (const char of json) {
        if (escaped) {
            result += char;
            escaped = false;
            continue;
        }

        if (char === "\\") {
            result += char;
            escaped = inString;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            result += char;
            continue;
        }

        const code = char.codePointAt(0)!;

        if (inString && code < 0x20) {
            if (char === "\n") result += "\\n";
            else if (char === "\r") result += "\\r";
            else if (char === "\t") result += "\\t";
            else if (char === "\b") result += "\\b";
            else if (char === "\f") result += "\\f";
            else result += `\\u${code.toString(16).padStart(4, "0")}`;
            continue;
        }

        result += char;
    }

    return result;
}
