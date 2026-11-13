// Stage 4: compute accuracy and rankings, and write the JSON the website reads.
import { CATEGORIES, SCORING } from "./config.mjs";
import { daysAgo, writeSiteData } from "./lib/store.mjs";

const pct = (c, n) => (n ? Math.round((1000 * c) / n) / 10 : null);

function rankWindow(category, people, predictions, days) {
  const since = daysAgo(days).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const stats = new Map();
  for (const p of predictions) {
    if (p.category !== category) continue;
    if (p.status !== "correct" && p.status !== "incorrect") continue;
    if (p.resolvesBy < since || p.resolvesBy > today) continue;
    if (!stats.has(p.personId)) stats.set(p.personId, { correct: 0, incorrect: 0, calls: [] });
    const s = stats.get(p.personId);
    s[p.status]++;
    s.calls.push(p);
  }

  const rows = [];
  const ids = new Set([...stats.keys(), ...people.filter((x) => x.category === category).map((x) => x.id)]);
  for (const id of ids) {
    const person = people.find((x) => x.id === id);
    if (!person) continue;
    const s = stats.get(id) || { correct: 0, incorrect: 0, calls: [] };
    const n = s.correct + s.incorrect;
    const score = (s.correct + SCORING.priorMean * SCORING.priorWeight) / (n + SCORING.priorWeight);
    rows.push({
      id,
      name: person.name,
      handle: person.handle,
      outlet: person.outlet,
      correct: s.correct,
      total: n,
      pct: pct(s.correct, n),
      score: Math.round(score * 1000) / 1000,
      recent: s.calls
        .sort((a, b) => b.resolvesBy.localeCompare(a.resolvesBy))
        .slice(0, 5)
        .map((c) => ({ claim: c.claim, status: c.status, date: c.resolvesBy, url: c.sourceUrl, evidence: c.evidenceUrl })),
    });
  }

  const ranked = rows
    .filter((r) => r.total >= SCORING.minResolved)
    .sort((a, b) => b.score - a.score || b.total - a.total || a.name.localeCompare(b.name))
    .map((r, i) => ({ rank: i + 1, ...r }));
  const unranked = rows
    .filter((r) => r.total < SCORING.minResolved)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { ranked, unranked };
}

export function score(db, people, { demo = false } = {}) {
  const predictions = Object.values(db.predictions);
  const generatedAt = new Date().toISOString();
  const summary = {
    generatedAt,
    demo,
    minResolved: SCORING.minResolved,
    tracked: people.length,
    predictionsTracked: predictions.length,
    predictionsResolved: predictions.filter((p) => p.status === "correct" || p.status === "incorrect").length,
    categories: [],
  };

  for (const cat of CATEGORIES) {
    const windows = {};
    for (const d of SCORING.windows) windows[d] = rankWindow(cat.id, people, predictions, d);
    writeSiteData(`${cat.id}.json`, { ...cat, generatedAt, demo, minResolved: SCORING.minResolved, windows });
    summary.categories.push({
      ...cat,
      rosterSize: people.filter((p) => p.category === cat.id).length,
      top: windows[7].ranked.slice(0, 5).map(({ recent, ...r }) => r),
      rankedCount: windows[7].ranked.length,
    });
  }
  writeSiteData("summary.json", summary);
  return summary;
}
