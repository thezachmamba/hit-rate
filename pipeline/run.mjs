// Entry point for the scheduled refresh: collect -> extract -> resolve -> score.
//   node pipeline/run.mjs          full run (needs ANTHROPIC_API_KEY)
//   node pipeline/run.mjs --demo   write labelled demo data only, no network or keys
import { KEYS } from "./config.mjs";
import { loadRoster, loadDb, saveDb } from "./lib/store.mjs";
import { collect } from "./collect.mjs";
import { extract } from "./extract.mjs";
import { resolve } from "./resolve.mjs";
import { score } from "./score.mjs";
import { demoDb } from "./demo.mjs";

const people = loadRoster();
const peopleById = new Map(people.map((p) => [p.id, p]));
const forceDemo = process.argv.includes("--demo");

const hasRealData = Object.keys(loadDb().predictions).length > 0;
if (forceDemo || (!KEYS.anthropic && !hasRealData)) {
  if (!forceDemo) console.log("ANTHROPIC_API_KEY is not set, so writing DEMO data instead of real rankings.");
  const s = score(demoDb(people), people, { demo: true });
  console.log(`demo: wrote rankings for ${s.tracked} people (synthetic data)`);
  process.exit(0);
}

if (!KEYS.anthropic) {
  console.log("ANTHROPIC_API_KEY is not set; re-scoring existing data without collecting.");
  score(loadDb(), people, { demo: false });
  process.exit(0);
}

const t0 = Date.now();
const db = loadDb();
console.log(`roster: ${people.length} people; sources: rss+news${KEYS.x ? "+x" : ""}${KEYS.serp ? "+serp" : ""}`);

await collect(db, people);
saveDb(db);
await extract(db, peopleById);
saveDb(db);
await resolve(db);

// Keep the state file small: drop raw posts older than 14 days once processed.
const cutoff = Date.now() - 14 * 864e5;
for (const [id, p] of Object.entries(db.posts)) {
  if (p.extracted && Date.parse(p.publishedAt) < cutoff) delete db.posts[id];
}
db.lastRun = new Date().toISOString();
saveDb(db);

const s = score(db, people, { demo: false });
console.log(`score: ${s.predictionsTracked} predictions tracked, ${s.predictionsResolved} resolved`);
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
