// Central settings for the refresh pipeline. Everything tunable lives here or in env vars.

export const CATEGORIES = [
  { id: "sports", label: "Sports", blurb: "NFL, NBA, MLB, NHL, college, soccer, golf and combat sports." },
  { id: "politics", label: "Politics", blurb: "Elections, polling, legislation, courts and government actions." },
  {
    id: "finance",
    label: "Finance & Economics",
    blurb: "Stocks and indices, Fed decisions, inflation and jobs data, commodities and company earnings.",
  },
];

export const SCORING = {
  // Windows shown on the site, in days.
  windows: [7, 30],
  // Someone needs at least this many resolved calls in a window to be ranked.
  minResolved: 3,
  // Bayesian shrinkage toward a coin flip, so 3/3 doesn't outrank 18/20.
  priorMean: 0.5,
  priorWeight: 5,
};

const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

export const LIMITS = {
  // Google News RSS is free but we stay polite: search this many people per run (rotating).
  newsPeoplePerRun: num(process.env.NEWS_PEOPLE_PER_RUN, 60),
  // SerpAPI costs per search, so it rotates through a smaller slice.
  serpPeoplePerRun: num(process.env.SERP_PEOPLE_PER_RUN, 25),
  // X API reads are billed per post; cap per run.
  xMaxPostsPerUser: num(process.env.X_MAX_POSTS_PER_USER, 20),
  xMaxUsersPerRun: num(process.env.X_MAX_USERS_PER_RUN, 400),
  // Claude calls per run.
  extractBatchSize: num(process.env.EXTRACT_BATCH_SIZE, 25),
  extractMaxPostsPerRun: num(process.env.EXTRACT_MAX_POSTS_PER_RUN, 1500),
  resolveMaxPerRun: num(process.env.RESOLVE_MAX_PER_RUN, 120),
  // Ignore source items older than this.
  maxPostAgeDays: 10,
};

export const MODELS = {
  extract: process.env.MODEL_EXTRACT || "claude-opus-5-5",
  resolve: process.env.MODEL_RESOLVE || "claude-opus-5-5",
};

export const KEYS = {
  anthropic: process.env.ANTHROPIC_API_KEY || "",
  x: process.env.X_BEARER_TOKEN || "",
  serp: process.env.SERPAPI_KEY || "",
};
