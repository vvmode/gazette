import { fetchScrapedPosts } from "./scraper.js";
import { filterUnseen, markSeen } from "./store-blobs.js";
import { sendTelegramMessage } from "./telegram.js";

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

// The official API has 500'd on every data endpoint in every test since this
// project started (server-side bug, not fixable here) - calling it first
// just adds a guaranteed-failed OAuth+request round trip to every run's
// latency, which is what pushed scheduled invocations over Netlify's ~15s
// ceiling. Go straight to the scraper; see NOTES.md if the API ever gets
// fixed and this is worth revisiting.
async function getPosts() {
  const posts = await fetchScrapedPosts();
  return { source: "scrape", posts };
}

export async function run({ seed = false } = {}) {
  const { source, posts } = await getPosts();
  const unseen = await filterUnseen(posts);

  // Mark everything fetched as seen, whether or not it matched, so we never
  // re-evaluate the same post twice on the next run.
  await markSeen(posts);

  if (seed) {
    const message = `[${source}] Seeded ${posts.length} existing post(s) as already-seen. No notifications sent.`;
    console.log(message);
    return { source, total: posts.length, notified: 0, message };
  }

  if (unseen.length === 0) {
    const message = `[${source}] No new IT-related posts (checked 0 new of ${posts.length} total).`;
    console.log(message);
    return { source, total: posts.length, notified: 0, message };
  }

  console.log(`[${source}] Found ${unseen.length} new IT-related post(s). Notifying...`);

  for (const post of unseen) {
    await sendTelegramMessage(formatMessage(post));
  }

  return { source, total: posts.length, notified: unseen.length };
}
