// Stage 3: grade predictions whose resolution date has passed, using Claude with web search.
import { LIMITS, MODELS } from "./config.mjs";
import { jsonCall } from "./lib/claude.mjs";

const SYSTEM = `You are a strict, neutral fact-checker grading whether a prediction came true.
Search the web for the actual outcome. Rules:
- "correct" only if the outcome clearly matches the claim as written.
- "incorrect" if the outcome clearly contradicts it.
- "void" if the event was cancelled or postponed, the claim is too ambiguous to grade, or reliable sources disagree.
- "pending" if the outcome is not yet known (for example a game not yet played or data not yet released).
Grade the claim exactly as written, not what the person may have meant. Cite one reliable source URL. Keep the note to one sentence.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "evidence_url", "note"],
  properties: {
    outcome: { type: "string", enum: ["correct", "incorrect", "void", "pending"] },
    evidence_url: { type: "string" },
    note: { type: "string" },
  },
};

const TOOLS = [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }];

export async function resolve(db, log = console.log) {
  const today = new Date().toISOString().slice(0, 10);
  const due = Object.values(db.predictions)
    .filter((p) => p.status === "open" && p.resolvesBy <= today)
    // Oldest first, and skip ones we checked in the last 12 hours.
    .filter((p) => !p.lastCheckedAt || Date.now() - Date.parse(p.lastCheckedAt) > 12 * 36e5)
    .sort((a, b) => a.resolvesBy.localeCompare(b.resolvesBy))
    .slice(0, LIMITS.resolveMaxPerRun);

  const tally = { correct: 0, incorrect: 0, void: 0, pending: 0, failed: 0 };
  // A few at a time to stay under rate limits.
  const CONCURRENCY = 4;
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    await Promise.all(
      due.slice(i, i + CONCURRENCY).map(async (p) => {
        const user = `Prediction made on ${p.madeAt.slice(0, 10)}: "${p.claim}"\nExpected to be known by: ${p.resolvesBy}\nToday: ${today}\nOriginal wording: "${p.quote}"`;
        try {
          const { data } = await jsonCall({
            model: MODELS.resolve,
            system: SYSTEM,
            user,
            schema: SCHEMA,
            tools: TOOLS,
            effort: "medium",
          });
          p.lastCheckedAt = new Date().toISOString();
          tally[data.outcome]++;
          if (data.outcome === "pending") {
            // Give up after 21 days past the expected date.
            if (Date.now() - Date.parse(p.resolvesBy) > 21 * 864e5) p.status = "void";
            return;
          }
          p.status = data.outcome;
          p.resolvedAt = new Date().toISOString();
          p.evidenceUrl = data.evidence_url || null;
          p.note = data.note;
        } catch (e) {
          tally.failed++;
          log(`  resolve failed for ${p.id}: ${e.message}`);
        }
      }),
    );
  }
  log(`resolve: ${due.length} due -> ${JSON.stringify(tally)}`);
  return tally;
}
