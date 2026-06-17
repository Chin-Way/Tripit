// lib/gemini.js
// Gemini (Google) itinerary engine — a drop-in alternative to the Claude engine.
// Selected with AI_PROVIDER=gemini + GEMINI_API_KEY. Loaded lazily; falls back to
// the rules engine on any error. Uses the same grounded shortlist and shared
// prompt/parse logic (aiShared.js) so output matches the Claude path.
//
// API surface verified against the installed @google/genai SDK:
//   new GoogleGenAI({apiKey}) -> ai.models.generateContent({model, contents, config})
//   config.systemInstruction / config.responseMimeType / config.thinkingConfig
//   response.text

import { shortlist } from "./engine.js";
import { profileText, buildSystem, parseJson, hydrate, fillHops } from "./aiShared.js";

// gemini-2.5-flash is Google's low-cost, high-volume tier (their own SDK quickstart
// default). Override with GEMINI_MODEL. See https://ai.google.dev/gemini-api/docs/models
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export async function aiPlan(answers, data) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const candidates = shortlist(answers, data, 14);
  const system = buildSystem(candidates, answers, data.city || "Chicago");

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Build the itinerary for this family:\n\n${profileText(answers)}`,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json", // ask Gemini for strict JSON
      maxOutputTokens: 3500,
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 0 }, // snappy + cheaper; rules engine already did the scheduling
    },
  });

  const text = response.text;
  if (!text) throw new Error("Empty Gemini response");

  const days = hydrate(parseJson(text).days, data);
  if (!days.length) throw new Error("AI plan produced no usable days");
  fillHops(days, data);

  return { city: data.city || "Chicago", days, engine: "ai", provider: "gemini", model: MODEL };
}
