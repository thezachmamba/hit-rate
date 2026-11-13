// Builds an in-memory database of SYNTHETIC predictions so the site can be previewed before
// API keys exist. Everything produced here is fake and the site labels it as demo data.
import { hash, daysAgo } from "./lib/store.mjs";

function rng(seed) {
  let h = parseInt(hash(seed).slice(0, 8), 16) || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1e6) / 1e6;
  };
}

export function demoDb(people) {
  const db = { predictions: {} };
  const week = Math.floor(Date.now() / (7 * 864e5));
  for (const person of people) {
    const r = rng(`${person.id}|${week}`);
    const skill = 0.35 + r() * 0.4; // each fake pundit gets a "true" hit rate
    const count = Math.floor(r() * 14); // some make few calls, so they stay unranked
    for (let i = 0; i < count; i++) {
      const day = daysAgo(Math.floor(r() * 30)).toISOString().slice(0, 10);
      const id = hash(`${person.id}|demo|${i}`);
      db.predictions[id] = {
        id,
        personId: person.id,
        category: person.category,
        claim: `Sample ${person.category} prediction #${i + 1} (demo data, not a real call)`,
        status: r() < skill ? "correct" : "incorrect",
        resolvesBy: day,
        sourceUrl: null,
        evidenceUrl: null,
      };
    }
  }
  return db;
}
