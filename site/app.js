// Hit Rate front end. Hash routes: "" (home), #sports, #politics, #finance.
const CAT_COLORS = { sports: "var(--sports)", politics: "var(--politics)", finance: "var(--finance)" };
const cache = {};
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function load(name) {
  if (!cache[name]) cache[name] = fetch(`data/${name}.json`, { cache: "no-cache" }).then((r) => r.json());
  return cache[name];
}

function pctClass(p) {
  return p >= 65 ? "good" : p >= 50 ? "mid" : "bad";
}
function pctPill(p) {
  return `<span class="pct ${pctClass(p)}">${p.toFixed(p % 1 ? 1 : 0)}%</span>`;
}
function who(r) {
  const handle = r.handle
    ? `<a href="https://x.com/${esc(r.handle)}" target="_blank" rel="noopener">@${esc(r.handle)}</a>`
    : "";
  const sub = [handle, esc(r.outlet || "")].filter(Boolean).join(" · ");
  return `<div class="who"><span class="who-name">${esc(r.name)}</span><span class="who-sub">${sub}</span></div>`;
}
function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hr ago` : new Date(iso).toLocaleDateString();
}

function setChrome(route, summary) {
  document.querySelectorAll("nav a").forEach((a) => {
    if (a.dataset.route === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#demo-banner").hidden = !summary.demo;
  $("#updated").textContent = `Updated ${ago(summary.generatedAt)} · refreshes every 3 hours`;
}

async function renderHome() {
  const s = await load("summary");
  setChrome("", s);
  document.title = "Hit Rate";
  const boards = s.categories
    .map((c) => {
      const rows = c.top.length
        ? c.top
            .map(
              (r) => `<tr>
          <td class="rank ${r.rank === 1 ? "r1" : ""}">${r.rank}</td>
          <td>${who(r)}</td>
          <td class="num record">${r.correct}/${r.total}</td>
          <td class="num">${pctPill(r.pct)}</td></tr>`,
            )
            .join("")
        : `<tr><td colspan="4" class="empty">No one has ${s.minResolved}+ graded calls this week yet.</td></tr>`;
      return `<section class="board" style="--cat:${CAT_COLORS[c.id]}">
        <div class="board-head">
          <h2><span class="dot"></span>${esc(c.label)}</h2>
          <a class="see-all" href="#${c.id}">All ${c.rosterSize} →</a>
        </div>
        <div class="table-card"><div class="table-scroll"><table>
          <thead><tr><th>#</th><th>Pundit</th><th class="num">Record</th><th class="num">Hit rate</th></tr></thead>
          <tbody>${rows}</tbody></table></div></div>
      </section>`;
    })
    .join("");

  $("#app").innerHTML = `
    <div class="intro">
      <span class="eyebrow">Past 7 days</span>
      <h1>Who's actually calling it right</h1>
      <p class="lede">We collect the predictions ${s.tracked} pundits make on X, in articles and on their own sites, grade each one once the result is in, and rank them by hit rate.</p>
    </div>
    <div class="boards">${boards}</div>
    ${methodHtml(s)}`;
}

async function renderCategory(id) {
  const [s, c] = await Promise.all([load("summary"), load(id)]);
  setChrome(id, s);
  document.title = `${c.label} · Hit Rate`;
  const state = { win: "7", q: "" };

  $("#app").innerHTML = `<div id="cat" style="display:grid;gap:32px">
    <div class="intro" style="--cat:${CAT_COLORS[id]}">
      <span class="eyebrow"><span class="dot" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>${esc(c.label)}</span>
      <h1>${esc(c.label)} pundit rankings</h1>
      <p class="lede">${esc(c.blurb)} Ranked by hit rate on predictions that resolved in the window. Click a row to see the calls behind the number.</p>
    </div>
    <div class="toolbar">
      <div class="tabs" role="group" aria-label="Time window">
        <button type="button" id="w7" data-w="7" aria-pressed="true">Past 7 days</button>
        <button type="button" id="w30" data-w="30" aria-pressed="false">Past 30 days</button>
      </div>
      <input class="search" id="q" type="search" placeholder="Search name or handle" aria-label="Search pundits">
    </div>
    <div id="ranked" style="--cat:${CAT_COLORS[id]}"></div>
    <div id="unranked"></div>
    ${methodHtml(s)}</div>`;

  function draw() {
    const w = c.windows[state.win];
    const q = state.q.toLowerCase();
    const match = (r) => !q || r.name.toLowerCase().includes(q) || (r.handle || "").toLowerCase().includes(q);
    const ranked = w.ranked.filter(match);
    const body = ranked.length
      ? ranked
          .map(
            (r) => `<tr class="row" tabindex="0" data-id="${esc(r.id)}">
        <td class="rank ${r.rank === 1 ? "r1" : ""}">${r.rank}</td>
        <td>${who(r)}</td>
        <td class="num record">${r.correct}/${r.total}</td>
        <td class="hide-sm"><div class="bar"><span style="width:${r.pct}%"></span></div></td>
        <td class="num">${pctPill(r.pct)}</td></tr>
        <tr class="detail" data-for="${esc(r.id)}" hidden><td colspan="5">${callsHtml(r, c.demo)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="empty">${q ? "No ranked pundit matches that search." : `No one has ${c.minResolved}+ graded calls in this window yet.`}</td></tr>`;
    $("#ranked").innerHTML = `<div class="table-card"><div class="table-scroll"><table>
      <thead><tr><th>#</th><th>Pundit</th><th class="num">Record</th><th class="hide-sm">Accuracy</th><th class="num">Hit rate</th></tr></thead>
      <tbody>${body}</tbody></table></div></div>`;

    const un = w.unranked.filter(match);
    $("#unranked").innerHTML = un.length
      ? `<div style="display:grid;gap:12px"><div class="board-head"><h2>Tracked, not ranked yet</h2><span class="meta">fewer than ${c.minResolved} graded calls · ${un.length}</span></div>
         <div class="table-card unranked">${un
           .map((r) => `<div><span class="who-name" title="${esc(r.name)}">${esc(r.name)}</span><span class="record">${r.correct}/${r.total}</span></div>`)
           .join("")}</div></div>`
      : "";
  }

  $("#cat").addEventListener("click", (e) => {
    const b = e.target.closest(".tabs button");
    if (b) {
      state.win = b.dataset.w;
      document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw();
      return;
    }
    const row = e.target.closest("tr.row");
    if (row && !e.target.closest("a")) toggle(row);
  });
  $("#cat").addEventListener("keydown", (e) => {
    const row = e.target.closest?.("tr.row");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(row); }
  });
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; draw(); });
  draw();
}

function toggle(row) {
  const d = document.querySelector(`tr.detail[data-for="${CSS.escape(row.dataset.id)}"]`);
  if (d) d.hidden = !d.hidden;
}

function callsHtml(r, demo) {
  if (!r.recent.length) return `<span class="meta">No calls recorded.</span>`;
  return `<ul class="calls">${r.recent
    .map((c) => {
      const src = c.url ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener">source</a>` : "";
      const ev = c.evidence ? ` · <a href="${esc(c.evidence)}" target="_blank" rel="noopener">result</a>` : "";
      return `<li><span class="tag ${c.status}">${c.status === "correct" ? "Hit" : "Miss"}</span><span class="d">${c.date}</span><span>${esc(c.claim)}${src}${ev}</span></li>`;
    })
    .join("")}</ul>${demo ? `<p class="meta" style="margin:8px 0 0">Demo data: these are placeholder calls, not real predictions.</p>` : ""}`;
}

function methodHtml(s) {
  return `<section class="method" id="how">
    <h2>How the scoring works</h2>
    <p>Every 3 hours we pull new posts from X, articles that quote each pundit, and the newsletters and blogs they write. An AI model keeps only concrete, checkable predictions (a game result, an election call, a Fed decision, an index level) and notes the date the answer will be known.</p>
    <p>After that date, the prediction is graded hit or miss against news sources, with a link to the result. Calls that can't be graded fairly (cancelled events, ambiguous wording) are dropped.</p>
    <p>Hit rate is hits divided by graded calls that resolved in the window. To keep a lucky 3-for-3 from beating a steady 18-for-20, the order uses a confidence-adjusted score that pulls small samples toward 50%. You need at least ${s.minResolved} graded calls in the window to be ranked.</p>
  </section>`;
}

function route() {
  const r = location.hash.replace("#", "");
  const p = ["sports", "politics", "finance"].includes(r) ? renderCategory(r) : renderHome();
  p.catch((e) => {
    $("#app").innerHTML = `<p class="empty">Couldn't load the rankings data (${esc(e.message)}). Try refreshing the page.</p>`;
  });
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
route();
