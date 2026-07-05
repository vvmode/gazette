import pg from "pg";

const { Pool } = pg;

let pool;
let ensureTablePromise;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL (or NETLIFY_DATABASE_URL) is not set");
    }
    // One-shot invocations (local script or a scheduled function run) only
    // ever need a single connection at a time.
    pool = new Pool({ connectionString, max: 1 });
  }
  return pool;
}

export async function closeStore() {
  if (pool) {
    await pool.end();
    pool = undefined;
    ensureTablePromise = undefined;
  }
}

async function ensureTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS seen_posts (
        iulaan_id TEXT PRIMARY KEY,
        seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }
  await ensureTablePromise;
}

function idOf(post) {
  return String(post.iulaan_id ?? post.id);
}

export async function filterUnseen(posts) {
  if (posts.length === 0) return [];
  await ensureTable();

  const ids = posts.map(idOf);
  const { rows } = await getPool().query("SELECT iulaan_id FROM seen_posts WHERE iulaan_id = ANY($1)", [ids]);
  const seen = new Set(rows.map((r) => r.iulaan_id));

  return posts.filter((post) => !seen.has(idOf(post)));
}

export async function markSeen(posts) {
  if (posts.length === 0) return;
  await ensureTable();

  const ids = posts.map(idOf);
  await getPool().query(
    `INSERT INTO seen_posts (iulaan_id)
     SELECT * FROM unnest($1::text[])
     ON CONFLICT (iulaan_id) DO NOTHING`,
    [ids],
  );
}
