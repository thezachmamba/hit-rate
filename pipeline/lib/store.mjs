// Tiny JSON-file store. The whole state is committed to the repo by the scheduled job,
// so the pipeline is stateless between runs apart from data/db.json.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "../config.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DB_PATH = path.join(ROOT, "data", "db.json");

export function hash(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

export function slug(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-");
}

export function loadRoster() {
  const people = [];
  for (const cat of CATEGORIES) {
    const file = path.join(ROOT, "roster", `${cat.id}.csv`);
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (const line of lines.slice(1)) {
      const [name, handle, outlet, feeds] = line.split("|").map((x) => (x || "").trim());
      if (!name) continue;
      people.push({
        id: `${cat.id}:${slug(name)}`,
        category: cat.id,
        name,
        handle: handle || null,
        outlet: outlet || null,
        feeds: feeds ? feeds.split(/\s+/).filter(Boolean) : [],
      });
    }
  }
  return people;
}

export function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    return { version: 1, posts: {}, predictions: {}, xUserIds: {}, cursors: {}, lastRun: null };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

export function saveDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 1));
}

export function writeSiteData(name, obj) {
  const dir = path.join(ROOT, "site", "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
}

export const daysAgo = (n) => new Date(Date.now() - n * 864e5);
