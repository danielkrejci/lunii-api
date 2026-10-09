import { GoogleGenAI } from "@google/genai";

import { appEnv } from "../env/appEnv";

export const ai = new GoogleGenAI({
    apiKey: appEnv.GEMINI_API_KEY,
});
