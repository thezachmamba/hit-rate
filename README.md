# Hit Rate

Weekly accuracy rankings for sports, politics, and finance & economics pundits. The home page shows the top 5 per category over the past 7 days. Each category page lists the full roster (100 to 130 people) with 7-day and 30-day rankings and the calls behind each number.

## How it works

Every 3 hours a GitHub Action runs `pipeline/run.mjs`:

1. **Collect** (`pipeline/collect.mjs`) new posts and articles for everyone in `roster/*.csv`:
   - Newsletter and blog RSS feeds listed in the roster (free)
   - Google News RSS search for each person's name plus prediction words (free; 60 people per run, so everyone is covered about 3 times a day)
   - X/Twitter timelines through the X API v2 (needs `X_BEARER_TOKEN`)
   - Google web results through SerpAPI (optional, needs `SERPAPI_KEY`)
2. **Extract** (`pipeline/extract.mjs`): Claude reads new posts and keeps only concrete, checkable predictions made by that person, each with a date the answer will be known.
3. **Grade** (`pipeline/resolve.mjs`): after that date, Claude searches the web and marks each call correct, incorrect, or void, with a source link.
4. **Score** (`pipeline/score.mjs`): hit rate = correct / graded calls that resolved in the window. The order uses a shrunk score `(correct + 2.5) / (graded + 5)` so small samples are pulled toward 50%. At least 3 graded calls are needed to be ranked.

State lives in `data/db.json`, committed back to the repo by the Action. The site is static (`site/`) and reads `site/data/*.json`.

## Setup

1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Repo **Settings → Secrets and variables → Actions**, add:
   - `ANTHROPIC_API_KEY` (required for real data)
   - `X_BEARER_TOKEN` (strongly recommended; X is where most pundits post picks)
   - `SERPAPI_KEY` (optional)
4. Run the **Refresh rankings** workflow once by hand (Actions tab → Run workflow). After that it runs every 3 hours.

Until `ANTHROPIC_API_KEY` is set, the site shows clearly labelled demo data.

## Costs to expect

- **Claude API**: the main cost. Extraction runs on every new post and grading uses web search. Both stages default to `claude-opus-5-5`. To cut cost, set repo variables or env `MODEL_EXTRACT=claude-haiku-5-5` (extraction is the high-volume step), and tune `EXTRACT_MAX_POSTS_PER_RUN` and `RESOLVE_MAX_PER_RUN`.
- **X API**: reads are billed. The full roster at 20 posts per person per run is far more than the cheapest tier allows, so start with `X_MAX_POSTS_PER_USER=10` and `X_MAX_USERS_PER_RUN=100` (the job rotates through everyone) and raise as budget allows. Check X's current pricing page before subscribing.
- **SerpAPI**: billed per search; `SERP_PEOPLE_PER_RUN=25` means about 200 searches a day.
- **GitHub Actions and Pages**: free for public repos.

## Editing the roster

`roster/sports.csv`, `roster/politics.csv`, `roster/finance.csv` use `name|handle|outlet|feeds` (feeds are space-separated RSS URLs). X handles were filled in from public knowledge and should be spot-checked; the X stage logs any handle it can't find. Someone's calls in another category still count there (Nate Silver's NFL picks count toward Sports).

## Local commands

```
npm install
npm run demo      # write demo data
npm run refresh   # full run (needs keys in env)
npm run serve     # http://localhost:8080
```

When running locally behind a proxy, Node's fetch needs `NODE_USE_ENV_PROXY=1`.
