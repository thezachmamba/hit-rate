// Stage 2: turn raw posts into concrete, checkable predictions using Claude.
import { LIMITS, MODELS } from "./config.mjs";
import { jsonCall } from "./lib/claude.mjs";
import { hash } from "./lib/store.mjs";

const SYSTEM = `You extract verifiable predictions made by a specific media personality from their posts, or from articles quoting them.

Extract a prediction only when ALL of these hold:
- The named person themselves made it (not the article author, not another pundit, not "sources say").
- It is a forecast about a future outcome that will be clearly true or false: a game or series result, a pick against the spread, an award, a draft or trade outcome stated as a forecast, an election or vote result, a poll threshold, a bill passing, a court ruling, a Fed decision, a data release (CPI, jobs), an index or stock level, an earnings beat or miss.
- You can name a date by which the outcome will be known (resolves_by). Use the event date when known; otherwise the end of the stated period. If no date can be reasonably inferred, skip it.

Skip: opinions and hot takes with no checkable outcome ("he's overrated"), questions, jokes, retweets of others, reporting of facts that already happened, insider news reported as fact ("X is signing with Y"), and vague long-range calls beyond 18 months.

Write each claim as one self-contained sentence a fact-checker could verify later, with names, numbers and dates spelled out (e.g. "The Kansas City Chiefs will beat the Buffalo Bills on 2026-11-16."). Category must be sports, politics or finance (finance covers markets, macroeconomics, the Fed, commodities and companies). Return an empty list when there are none; most posts contain none.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["predictions"],
  properties: {
    predictions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["post_id", "claim", "category", "resolves_by", "quote"],
        properties: {
          post_id: { type: "string" },
          claim: { type: "string" },
          category: { type: "string", enum: ["sports", "politics", "finance"] },
          resolves_by: { type: "string", description: "YYYY-MM-DD" },
          quote: { type: "string", description: "Short verbatim snippet showing the prediction" },
        },
      },
    },
  },
};

export async function extract(db, peopleById, log = console.log) {
  const pending = Object.values(db.posts)
    .filter((p) => !p.extracted)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, LIMITS.extractMaxPostsPerRun);

  // Group by person so the model knows whose predictions to look for.
  const byPerson = new Map();
  for (const post of pending) {
    if (!byPerson.has(post.personId)) byPerson.set(post.personId, []);
    byPerson.get(post.personId).push(post);
  }

  let found = 0;
  let calls = 0;
  for (const [personId, posts] of byPerson) {
    const person = peopleById.get(personId);
    if (!person) continue;
    for (let i = 0; i < posts.length; i += LIMITS.extractBatchSize) {
      const batch = posts.slice(i, i + LIMITS.extractBatchSize);
      const body = batch
        .map((p) => `<post id="${p.id}" source="${p.source}" date="${p.publishedAt.slice(0, 10)}">\n${p.text}\n</post>`)
        .join("\n\n");
      const user = `Person: ${person.name}${person.handle ? ` (@${person.handle})` : ""}, ${person.outlet || ""}\nToday: ${new Date().toISOString().slice(0, 10)}\n\n${body}`;
      try {
        const { data } = await jsonCall({ model: MODELS.extract, system: SYSTEM, user, schema: SCHEMA, effort: "low" });
        calls++;
        const ids = new Set(batch.map((p) => p.id));
        for (const pr of data.predictions) {
          if (!ids.has(pr.post_id) || !/^\d{4}-\d{2}-\d{2}$/.test(pr.resolves_by)) continue;
          const id = hash(`${personId}|${pr.claim.toLowerCase().replace(/\W+/g, " ").trim()}`);
          if (db.predictions[id]) continue;
          const post = db.posts[pr.post_id];
          db.predictions[id] = {
            id,
            personId,
            category: pr.category,
            claim: pr.claim,
            quote: pr.quote,
            postId: pr.post_id,
            sourceUrl: post.url,
            madeAt: post.publishedAt,
            resolvesBy: pr.resolves_by,
            status: "open", // open | correct | incorrect | void
            resolvedAt: null,
            evidenceUrl: null,
            note: null,
          };
          found++;
        }
        for (const p of batch) p.extracted = true;
      } catch (e) {
        log(`  extract failed for ${person.name}: ${e.message}`);
      }
    }
  }
  log(`extract: ${calls} calls, ${found} new predictions`);
  return found;
}
