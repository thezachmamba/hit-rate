import Anthropic from "@anthropic-ai/sdk";
import { KEYS } from "../config.mjs";

let client;
export function claude() {
  if (!client) client = new Anthropic({ apiKey: KEYS.anthropic, maxRetries: 4 });
  return client;
}

// Calls the Messages API with structured JSON output and returns the parsed object.
// Server-side refusal fallbacks are on so a safety decline re-runs on a fallback model.
export async function jsonCall({ model, system, user, schema, tools, maxTokens = 16000, effort = "medium" }) {
  const messages = [{ role: "user", content: user }];
  let res;
  // Server tools (web search) can pause a long turn; resend to let it continue.
  for (let i = 0; i < 4; i++) {
    res = await claude().beta.messages.create({
      model,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort, format: { type: "json_schema", schema } },
      system,
      messages,
      ...(tools ? { tools } : {}),
    });
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  if (res.stop_reason === "refusal") throw new Error("model declined the request");
  if (res.stop_reason === "max_tokens") throw new Error("response hit max_tokens");
  // With server tools there may be several text blocks; the structured JSON is the last one.
  const texts = res.content.filter((b) => b.type === "text").map((b) => b.text.trim()).filter(Boolean);
  const text = texts[texts.length - 1] || "";
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`no JSON in response: ${text.slice(0, 200)}`);
  return { data: JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)), usage: res.usage };
}
