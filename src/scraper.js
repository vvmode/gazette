const BASE_URL = "https://www.gazette.gov.mv";

// Site-side search catches both job postings and tenders/RFPs mentioning
// these terms, in any language mix (titles are often English even on the
// Dhivehi site).
//
// One keyword per run, not all of them at once: firing all ~12 concurrently
// pushed total scrape time close enough to Netlify's scheduled-invocation
// ceiling (~15s) to cause frequent timeouts. Instead each run only searches
// one keyword (see currentSearchQuery below), rotating to the next one every
// ROTATION_MS - full coverage still happens, just spread over 2 hours
// instead of packed into one run. The job-category URL below is NOT part of
// this rotation - it runs every time since it's the near-zero-false-positive
// primary source.
const SEARCH_QUERIES = [
  "software",
  "developer",
  "website",
  "web development",
  "application development",
  "programmer",
  // Dhivehi/Thaana equivalents, verified against live results. Skipped
  // "ސިސްޓަމް" (system) - too generic, mostly matches CCTV/plumbing/hardware
  // procurement rather than software.
  // "ސޮފްޓްވެއަރ" dropped - it's a superset match of "ސޮފްޓްވެއަ" below (any
  // title containing the former also contains the latter as a substring), so
  // searching the shorter form alone already covers both and saves a slot.
  "ސޮފްޓްވެއަ", // software
  "ވެބްސައިޓް", // website (spelling 1)
  "ވެބްސައިޓު", // website (spelling 2, catches different posts than spelling 1)
  "ޕޯޓަލް", // portal
  // "އެޕްލިކޭޝަން" (application) mostly matches job/visa/scholarship
  // "application" notices in Dhivehi, not software applications - expect
  // some noise from this one. "އެޕްލިކޭސަން" (alt spelling) currently has
  // zero matches in the corpus but is kept in case that changes.
  "އެޕްލިކޭޝަން",
  "އެޕްލިކޭސަން",
];

// Rotates through SEARCH_QUERIES by wall-clock time rather than persisted
// state, so it stays correct even if runs are skipped or retried - every
// ROTATION_MS window deterministically maps to the same keyword.
// 12 queries * 10 minutes = full coverage every 2 hours, matching the
// "*/10 * * * *" schedule.
const ROTATION_MS = 10 * 60 * 1000;

function currentSearchQuery() {
  const index = Math.floor(Date.now() / ROTATION_MS) % SEARCH_QUERIES.length;
  return SEARCH_QUERIES[index];
}

// The site's own job-category filter already isolates IT vacancies exactly,
// so this one is a near-zero-false-positive source.
// open-only=1 restricts results to postings whose deadline hasn't passed yet
// (the site's "ސުންގަޑި ހަމަނުވާ އިޢުލާންތައް އެކަނި" checkbox), so we don't
// notify about opportunities that are already closed.
const IT_JOB_CATEGORY_URL = `${BASE_URL}/iulaan?type=vazeefaa&job-category=information-technology&open-only=1`;

// Scholarship/study-loan notices use the word "application" in the
// bureaucratic sense (form submission), not software - "އެޕްލިކޭޝަން"
// matches them too, so explicitly exclude by these stems. Substrings, not
// whole words, since Dhivehi attaches suffixes directly (e.g. "ތަޢުލީމު"
// becomes "ތަޢުލީމާއި" with a suffix) - matching the stem catches both.
const EXCLUDE_STEMS = [
  "ތަޢުލީމ", // education/academic (scholarship notices)
  "ލޯނު", // loan
];

function isExcluded(title) {
  return EXCLUDE_STEMS.some((stem) => title.includes(stem));
}

// Pairs each listing item's type badge (e.g. "masakkaiy", "beelan") with its
// title - the two sit next to each other in each item block, so a
// non-greedy span between them keeps them correctly aligned.
const ITEM_RE =
  /<a class="iulaan-type" href="\/iulaan\?type=([a-z-]+)"[^>]*>[^<]*<\/a>[\s\S]*?<a class="iulaan-title" href="([^"]+)" title="view details">([^<]*)<\/a>/g;

function parseListing(html, source) {
  const posts = [];
  for (const match of html.matchAll(ITEM_RE)) {
    const type = match[1];
    const url = match[2];
    const title = match[3].trim();
    const idMatch = url.match(/\/iulaan\/(\d+)/);
    if (!idMatch) continue;
    if (isExcluded(title)) continue;
    posts.push({ iulaan_id: idMatch[1], title, url, type, source });
  }
  return posts;
}

// This is just a safety net for a genuinely hung socket - the real ceiling
// on total batch time is GLOBAL_DEADLINE_MS below, which is what actually
// needs to stay under Netlify's scheduled-invocation limit.
const REQUEST_TIMEOUT_MS = 12_000;

async function fetchListing(url, source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GazetteITWatch/1.0)" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Gazette website request failed (${url}): ${res.status}`);
    }
    return parseListing(await res.text(), source);
  } finally {
    clearTimeout(timeout);
  }
}

// The site's response time under concurrent load is highly variable
// (has ranged from ~3s to ~14s tail latency in testing, seemingly
// load-dependent on their end) - too unpredictable to budget for with a
// fixed per-request timeout alone. So this run also has a hard deadline:
// after GLOBAL_DEADLINE_MS we stop waiting and go with whatever queries
// have finished so far. A query that misses this run's window gets
// retried next run - nothing is marked "seen" until it's actually
// fetched, so no post can be silently skipped, only delayed.
const GLOBAL_DEADLINE_MS = 9_000;

export async function fetchScrapedPosts() {
  const requests = [
    { url: IT_JOB_CATEGORY_URL, source: "job" },
    {
      url: `${BASE_URL}/iulaan?q=${encodeURIComponent(currentSearchQuery())}&open-only=1`,
      source: "notice",
    },
  ];

  const byId = new Map();
  function collect(posts) {
    for (const post of posts) {
      // First source in `requests` order wins the source tag if an id shows
      // up in more than one result set - the job-category URL is first, so
      // a post matching both stays labeled "job".
      if (!byId.has(post.iulaan_id)) byId.set(post.iulaan_id, post);
    }
  }

  const pending = requests.map(({ url, source }) =>
    fetchListing(url, source)
      .then(collect)
      .catch((err) => console.warn("Scrape query failed:", err.message)),
  );

  await Promise.race([Promise.allSettled(pending), new Promise((resolve) => setTimeout(resolve, GLOBAL_DEADLINE_MS))]);

  return [...byId.values()];
}
