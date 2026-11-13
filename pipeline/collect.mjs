// Stage 1: gather raw posts/articles for everyone on the roster.
//   - RSS feeds listed in the roster (Substacks, blogs): free
//   - Google News RSS search per person: free, rotates through the roster
//   - X/Twitter API v2 user timelines: needs X_BEARER_TOKEN (paid)
//   - SerpAPI Google search: needs SERPAPI_KEY (paid), rotates
import { KEYS, LIMITS } from "./config.mjs";
import { hash, daysAgo } from "./lib/store.mjs";

const UA = "prediction-rankings-bot/1.0 (+rss reader)";

function decode(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = decode(tag(b, "link"));
    if (!link) {
      const m = b.match(/<link[^>]+href="([^"]+)"/i);
      link = m ? m[1] : "";
    }
    const body = tag(b, "content:encoded") || tag(b, "description") || tag(b, "summary") || tag(b, "content");
    items.push({
      title: decode(tag(b, "title")),
      link,
      text: decode(body).slice(0, 4000),
      date: decode(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated")),
      source: decode(tag(b, "source")),
    });
  }
  return items;
}

async function getText(url, headers = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function addPost(db, person, source, { url, text, publishedAt }) {
  const when = new Date(publishedAt || Date.now());
  if (isNaN(when) || when < daysAgo(LIMITS.maxPostAgeDays)) return false;
  const id = hash(`${person.id}|${url || text}`);
  if (db.posts[id]) return false;
  db.posts[id] = {
    id,
    personId: person.id,
    source,
    url: url || null,
    text: text.slice(0, 4000),
    publishedAt: when.toISOString(),
    collectedAt: new Date().toISOString(),
    extracted: false,
  };
  return true;
}

// Picks a rotating slice of the roster so every person is covered over several runs.
function rotate(db, key, people, n) {
  const start = db.cursors[key] || 0;
  const slice = [];
  for (let i = 0; i < Math.min(n, people.length); i++) slice.push(people[(start + i) % people.length]);
  db.cursors[key] = (start + slice.length) % Math.max(people.length, 1);
  return slice;
}

async function collectFeeds(db, people, log) {
  let added = 0;
  for (const p of people.filter((x) => x.feeds.length)) {
    for (const feed of p.feeds) {
      try {
        for (const it of parseFeed(await getText(feed))) {
          if (addPost(db, p, "rss", { url: it.link, text: `${it.title}\n\n${it.text}`, publishedAt: it.date })) added++;
        }
      } catch (e) {
        log(`  feed failed for ${p.name}: ${e.message}`);
      }
    }
  }
  return added;
}

async function collectGoogleNews(db, people, log) {
  let added = 0;
  for (const p of rotate(db, "news", people, LIMITS.newsPeoplePerRun)) {
    const q = `"${p.name}" (predicts OR prediction OR picks OR expects OR "will win" OR forecast) when:3d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    try {
      for (const it of parseFeed(await getText(url)).slice(0, 15)) {
        const text = `${it.title}${it.source ? ` (${it.source})` : ""}\n\n${it.text}`;
        if (addPost(db, p, "news", { url: it.link, text, publishedAt: it.date })) added++;
      }
    } catch (e) {
      log(`  news failed for ${p.name}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return added;
}

async function collectSerp(db, people, log) {
  if (!KEYS.serp) return 0;
  let added = 0;
  for (const p of rotate(db, "serp", people, LIMITS.serpPeoplePerRun)) {
    const q = `"${p.name}" prediction OR picks OR predicts`;
    const url = `https://serpapi.com/search.json?engine=google&tbs=qdr:d&num=10&q=${encodeURIComponent(q)}&api_key=${KEYS.serp}`;
    try {
      const data = JSON.parse(await getText(url));
      for (const r of data.organic_results || []) {
        const text = `${r.title}\n\n${r.snippet || ""}`;
        if (addPost(db, p, "serp", { url: r.link, text, publishedAt: r.date || Date.now() })) added++;
      }
    } catch (e) {
      log(`  serp failed for ${p.name}: ${e.message}`);
    }
  }
  return added;
}

async function xGet(path) {
  const res = await fetch(`https://api.x.com/2${path}`, {
    headers: { authorization: `Bearer ${KEYS.x}` },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 429) throw Object.assign(new Error("X rate limited"), { rateLimited: true });
  if (!res.ok) throw new Error(`X ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function collectX(db, people, log) {
  if (!KEYS.x) return 0;
  const withHandles = people.filter((p) => p.handle);
  // Resolve handles to user ids in batches of 100, cached forever.
  const missing = withHandles.filter((p) => !db.xUserIds[p.handle.toLowerCase()]);
  for (let i = 0; i < missing.length; i += 100) {
    const names = missing.slice(i, i + 100).map((p) => p.handle).join(",");
    try {
      const data = await xGet(`/users/by?usernames=${names}`);
      for (const u of data.data || []) db.xUserIds[u.username.toLowerCase()] = u.id;
      for (const err of data.errors || []) log(`  X lookup: ${err.value || ""} ${err.detail || err.title}`);
    } catch (e) {
      log(`  X user lookup failed: ${e.message}`);
      return 0;
    }
  }
  let added = 0;
  for (const p of rotate(db, "x", withHandles, LIMITS.xMaxUsersPerRun)) {
    const uid = db.xUserIds[p.handle.toLowerCase()];
    if (!uid) continue;
    const since = db.cursors[`x:${uid}`];
    const qs = new URLSearchParams({
      max_results: String(Math.max(5, Math.min(100, LIMITS.xMaxPostsPerUser))),
      exclude: "retweets",
      "tweet.fields": "created_at,conversation_id",
    });
    if (since) qs.set("since_id", since);
    else qs.set("start_time", daysAgo(LIMITS.maxPostAgeDays).toISOString());
    try {
      const data = await xGet(`/users/${uid}/tweets?${qs}`);
      if (data.meta?.newest_id) db.cursors[`x:${uid}`] = data.meta.newest_id;
      for (const t of data.data || []) {
        const url = `https://x.com/${p.handle}/status/${t.id}`;
        if (addPost(db, p, "x", { url, text: t.text, publishedAt: t.created_at })) added++;
      }
    } catch (e) {
      log(`  X timeline failed for @${p.handle}: ${e.message}`);
      if (e.rateLimited) break;
    }
  }
  return added;
}

export async function collect(db, people, log = console.log) {
  const counts = {
    rss: await collectFeeds(db, people, log),
    news: await collectGoogleNews(db, people, log),
    serp: await collectSerp(db, people, log),
    x: await collectX(db, people, log),
  };
  log(`collect: new items ${JSON.stringify(counts)}`);
  return counts;
}
