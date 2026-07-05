const BASE_URL = "https://www.gazette.gov.mv";

// Site-side search catches both job postings and tenders/RFPs mentioning
// these terms, in any language mix (titles are often English even on the
// Dhivehi site). Kept short to avoid hammering the site each run.
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
  "ސޮފްޓްވެއަރ", // software
  "ސޮފްޓްވެއަ", // software (shorter spelling; substring of the above, kept for completeness)
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

async function fetchListing(url, source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

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

export async function fetchScrapedPosts() {
  const requests = [
    { url: IT_JOB_CATEGORY_URL, source: "job" },
    ...SEARCH_QUERIES.map((q) => ({
      url: `${BASE_URL}/iulaan?q=${encodeURIComponent(q)}&open-only=1`,
      source: "notice",
    })),
  ];

  // Run concurrently - sequential requests (even with a small delay between
  // each) add up past serverless function timeout limits once there are a
  // dozen-plus queries.
  const results = await Promise.all(requests.map(({ url, source }) => fetchListing(url, source)));

  const byId = new Map();
  for (const posts of results) {
    for (const post of posts) {
      // First source in `requests` order wins the source tag if an id shows
      // up in more than one result set - the job-category URL is first, so
      // a post matching both stays labeled "job".
      if (!byId.has(post.iulaan_id)) byId.set(post.iulaan_id, post);
    }
  }

  return [...byId.values()];
}
