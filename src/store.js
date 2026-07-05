import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const SEEN_FILE = path.join(DATA_DIR, "seen-ids.json");

function idOf(post) {
  return String(post.iulaan_id ?? post.id);
}

async function readSeenIds() {
  try {
    const raw = await readFile(SEEN_FILE, "utf-8");
    return new Set(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") return new Set();
    throw err;
  }
}

async function writeSeenIds(idSet) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SEEN_FILE, JSON.stringify([...idSet]), "utf-8");
}

export async function filterUnseen(posts) {
  const seen = await readSeenIds();
  return posts.filter((post) => !seen.has(idOf(post)));
}

export async function markSeen(posts) {
  const seen = await readSeenIds();
  for (const post of posts) seen.add(idOf(post));
  await writeSeenIds(seen);
}
