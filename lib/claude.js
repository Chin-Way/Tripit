// lib/claude.js
// Claude (Anthropic) itinerary engine. Loaded lazily only when selected, so the
// app runs with no dependencies when there's no key. Plans from the grounded
// shortlist and writes the personalized copy; the prompt is cached to cut cost.
// Shared prompt/parse logic lives in aiShared.js so Claude and Gemini stay in sync.

import { shortlist } from "./engine.js";
import { profileText, buildSystem, parseJson, hydrate, fillHops } from "./aiShared.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export async function aiPlan(answers, data) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

  const candidates = shortlist(answers, data, 14);
  const system = buildSystem(candidates, answers, data.city || "Chicago");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Build the itinerary for this family:\n\n${profileText(answers)}` }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text block in Claude response");

  const days = hydrate(parseJson(textBlock.text).days, data);
  if (!days.length) throw new Error("AI plan produced no usable days");
  fillHops(days, data);

  return { city: data.city || "Chicago", days, engine: "ai", provider: "claude", model: MODEL };
}
