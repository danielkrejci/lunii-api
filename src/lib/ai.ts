import { GoogleGenAI } from "@google/genai";

import { appEnv } from "../env";

export const ai = new GoogleGenAI({
    apiKey: appEnv.GEMINI_API_KEY,
});
