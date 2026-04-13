export function serializeDrizzleData<T>(obj: T): T {
    if (Array.isArray(obj)) {
        return obj.map(serializeDrizzleData) as unknown as T;
    } else if (typeof obj === "object" && obj !== null) {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [key, serializeDrizzleData(value)])
        ) as unknown as T;
    } else if (typeof obj === "string" && obj !== "" && !isNaN(Number(obj))) {
        return Number(obj) as unknown as T;
    } else {
        return obj;
    }
}
