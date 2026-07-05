process.loadEnvFile(".env");

import { fetchLatestIulaan } from "./src/gazetteClient.js";
import { fetchScrapedPosts } from "./src/scraper.js";
import { isItRelated } from "./src/filter.js";
import { filterUnseen, markSeen } from "./src/store.js";
import { sendTelegramMessage } from "./src/telegram.js";

// Announcement type slugs -> display label. "masakkaiy" (works) and "beelan"
// (tender) get a 🔴 flag - Telegram's Bot API has no text-color support, so
// a red-circle emoji is the closest equivalent to "highlight in red".
const TYPE_LABELS = {
  masakkaiy: "🔴 Works",
  "gannan-beynunvaa": "Purchase",
  vazeefaa: "Job",
  "aanmu-mauloomaathu": "Public Info",
  dhennevun: "Notice",
  "noos-bayaan": "Press Statement",
  beelan: "🔴 Tender",
};

function formatMessage(post) {
  const id = post.iulaan_id ?? post.id;
  const title = post.title ?? post.iulaan_title ?? "(no title)";
  const link = post.url ?? post.link ?? `https://www.gazette.gov.mv/iulaan/${id}`;
  const typeLabel = TYPE_LABELS[post.type] ?? post.type ?? "Unknown";
  const kind = post.source === "job" ? "💼 New IT Job" : "🖥️ New IT-related Gazette post";
  return `${kind} [${typeLabel}]\n${title}\n${link}`;
}

// Prefer the official API. It has been returning 500 on every data endpoint
// (server-side issue, not fixable here), so fall back to scraping the public
// website directly. The scraper's own IT-category/keyword URLs already do
// the relevance filtering, so its results skip the keyword filter below.
async function getPosts() {
  try {
    const posts = await fetchLatestIulaan();
    return { source: "api", posts, preFiltered: false };
  } catch (err) {
    console.warn("Gazette API unavailable, falling back to website scrape:", err.message);
    const posts = await fetchScrapedPosts();
    return { source: "scrape", posts, preFiltered: true };
  }
}

const isSeedRun = process.argv.includes("--seed");

async function main() {
  const { source, posts, preFiltered } = await getPosts();
  const unseen = await filterUnseen(posts);

  // Mark everything fetched as seen, whether or not it matched, so we never
  // re-evaluate the same post twice on the next run.
  await markSeen(posts);

  if (isSeedRun) {
    console.log(`[${source}] Seeded ${posts.length} existing post(s) as already-seen. No notifications sent.`);
    return;
  }

  const matches = preFiltered ? unseen : unseen.filter(isItRelated);

  if (matches.length === 0) {
    console.log(`[${source}] No new IT-related posts (checked ${unseen.length} new of ${posts.length} total).`);
    return;
  }

  console.log(`[${source}] Found ${matches.length} new IT-related post(s). Notifying...`);

  for (const post of matches) {
    await sendTelegramMessage(formatMessage(post));
  }
}

main().catch((err) => {
  console.error("Gazette watch run failed:", err);
  process.exit(1);
});
