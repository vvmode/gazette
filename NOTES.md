# Gazette IT Job/Tender Bot

Monitors gazette.gov.mv for new postings and notifies (via Telegram) on
anything related to software/website/application development.

Node.js, uses built-in `fetch` and `process.loadEnvFile`. Requires Node >=
20.6. Two dependencies: `pg` (Postgres client for the seen-posts store) and
`@netlify/functions` (only used by the Netlify scheduled function).

Can run two ways:
- **Locally**, via `node index.js` on a schedule (Windows Task Scheduler).
- **On Netlify**, as a scheduled serverless function (cloud, doesn't need
  your machine on/logged in) — see "Deploying to Netlify" below.

Both share the same logic in `src/run.js` and the same Postgres-backed seen
posts store, so switching between them (or running both at once) is safe —
whichever runs first for a given post marks it seen for the other.

## Status: API is broken, running on the scrape fallback

The official API (`https://api.gazette.gov.mv`) issues OAuth tokens fine but
returns `500 Server Error` on every data endpoint (`/iulaan`,
`/iulaan/unpublished`, `/iulaan/type/...`, even a known-good `/iulaan/{id}`)
for our registered client (`a22e300e-b1b1-4575-b00e-d6fe44f01ae3`). This is
server-side on Gazette's end — reported to them, unresolved as of writing.

`index.js` tries the API first on every run; if it throws, it automatically
falls back to scraping `https://www.gazette.gov.mv` directly. No code change
needed when the API gets fixed — it'll just start using it again.

## Sources

### API (`src/gazetteClient.js`) — preferred once it works
- OAuth token: `POST /oauth/token` with `{grant_type, client_id, client_secret}`
  from `.env`. Token is long-lived (~1 year) and cached in memory.
- `GET /iulaan` — latest announcements list
- `GET /iulaan/{id}` — detail (`iulaan_id`, `job_details`, `attachments`, ...)
- `GET /iulaan/type/{slug}` — filter by type (`vazeefaa` = jobs, etc.)
- `GET /iulaan/type/vazeefaa/category/information-technology` — IT jobs only

### Scrape fallback (`src/scraper.js`) — currently what actually runs
Hits the public site's own search/filter, so relevance filtering happens
server-side on Gazette's end, not just via our keyword list:
- `https://www.gazette.gov.mv/iulaan?type=vazeefaa&job-category=information-technology`
  — dedicated IT job category, near-zero false positives.
- `https://www.gazette.gov.mv/iulaan?q={keyword}` for: software, developer,
  website, web development, application development, programmer — catches
  tenders/RFPs too (website redesigns, ERP/HRMS software procurement, etc.),
  not just job vacancies.
- All scrape URLs include `open-only=1` (the site's "ސުންގަޑި ހަމަނުވާ
  އިޢުލާންތައް އެކަނި" / "only non-expired" checkbox, form field
  `name="open-only" value="1"`), so expired postings are excluded — only
  still-actionable opportunities get notified. This cut the result set from
  47 historical matches down to 5 currently-open ones.
- Dhivehi/Thaana keywords are included too (many titles are pure Thaana with
  no English loanword): `ސޮފްޓްވެއަރ`/`ސޮފްޓްވެއަ` (software, two spellings),
  `ވެބްސައިޓް`/`ވެބްސައިޓު` (website, two valid spellings — Dhivehi has no
  single standard transliteration so both are needed), `ޕޯޓަލް` (portal),
  `އެޕްލިކޭޝަން`/`އެޕްލިކޭސަން` (application, two spellings). These alone
  found 7 real postings (software license tenders, more engineer jobs, a
  council website tender) that pure English keywords missed entirely.
  Deliberately **not** included: `ސިސްޓަމް` (system) — mostly matches
  CCTV/plumbing/hardware procurement, not software; `ޓެކްނޮލޮޖީ` (technology)
  — redundant with the IT job-category source for jobs, and mostly
  hardware-equipment tenders otherwise. Note: `އެޕްލިކޭޝަން` (with ޝ) mostly
  matches job/visa/scholarship "application" notices in Dhivehi, not software
  applications — it's a known noise source, kept in at user's request;
  `އެޕްލިކޭސަން` (with ސ) currently has zero matches in the corpus. When
  extracting/typing Thaana strings for this file, always copy exact bytes
  from real fetched HTML (via a script) rather than typing by hand —
  visually-identical Thaana characters can be different Unicode code points
  and silently fail to match.
- Parses each listing item's `<a class="iulaan-type" href="/iulaan?type={slug}">`
  paired with its `<a class="iulaan-title" href="https://www.gazette.gov.mv/iulaan/{id}">{title}</a>`
  (regex, no HTML parser dependency) to capture the real announcement type
  slug (`masakkaiy`, `beelan`, `vazeefaa`, etc.) per post, not just the title.
  Results are already filtered by construction, so `index.js` skips the
  keyword filter for scrape-sourced posts.
- Each post carries `source` ("job" if found via the dedicated IT
  job-category URL, "notice" otherwise) and `type` (the site's actual
  announcement type slug). Telegram messages show both: `💼 New IT Job` /
  `🖥️ New IT-related Gazette post`, plus a `[Type]` tag. `masakkaiy` (works)
  and `beelan` (tender) are flagged with 🔴 since they're often the highest
  value/most time-sensitive tenders - Telegram's Bot API has no text-color
  support, so a red-circle emoji is the closest equivalent.
- One known false-positive category: broad terms like "programmer" can match
  unrelated posts (e.g. a scholarship announcement mentioning "allied
  programmers"). Acceptable tradeoff — false positives are harmless, missed
  posts are the thing to avoid.

## Pipeline (`src/run.js`, called by both `index.js` and the Netlify function)

1. Try the API; on any error, fall back to the scraper.
2. Compare `iulaan_id` against the `seen_posts` table in Postgres (see
   "Persistence" below) — skip dupes.
3. For API-sourced posts only: apply the keyword/category filter in
   `src/filter.js`. Scrape-sourced posts are already filtered by the
   query URLs used, so this step is skipped for them.
4. Mark every fetched post as seen (whether matched or not) so nothing is
   re-evaluated on the next run.
5. Send a Telegram message per new match, to every configured recipient.

## Persistence: Postgres (Netlify DB / Neon)

`src/store.js` uses a `seen_posts (iulaan_id TEXT PRIMARY KEY, seen_at)`
table (auto-created on first use) instead of a local file, since Netlify
Functions have no persistent filesystem between invocations. Connects via
`DATABASE_URL` (local `.env`) or `NETLIFY_DATABASE_URL` (auto-injected by
Netlify when the site is linked to a Netlify Database). A `pg.Pool` with
`max: 1` is used since only one run is ever in flight at a time; call
`closeStore()` when a one-shot invocation finishes so the process can exit.

## Telegram recipients

`TELEGRAM_CHAT_ID` accepts a comma-separated list (`src/telegram.js` splits
on `,`) — every listed chat ID gets every notification. Currently: `732724844`
(vvmode) and `496065737` (Immamohamed). To add someone: have them message the
bot (@GazetteMVRBot) once, then fetch
`https://api.telegram.org/bot<TOKEN>/getUpdates` to read their chat id from
the response, and append it to `TELEGRAM_CHAT_ID`.

## First run: seed, don't spam

The scraper currently returns a dozen or so open, currently-matching posts,
plus dozens more historical/closed ones the `open-only` filter excludes. On a
truly first run there is nothing in `seen_posts`, so everything currently
matching would look "new" and trigger a burst of Telegram messages at once.

Run once with `--seed` (or `npm run seed`) to mark all currently-found posts
as seen without sending any notifications. After that, `npm start` /
`node index.js` only notifies on posts that appear after the seed.

## Setup

1. Copy `.env.example` → already have `.env` with real Gazette API creds,
   Telegram bot token/chat ids, and the Postgres `DATABASE_URL`.
2. `npm install`
3. `npm run seed` — one-time, marks existing posts as seen, no notifications.
4. `npm start` — normal run, notifies on anything new since the seed.
5. Pick a scheduler: Windows Task Scheduler (local) or Netlify (cloud) —
   both below. `index.js` is a one-shot script either way, not a long-running
   process.

## Running on a schedule (Windows Task Scheduler)

Already set up. A scheduled task named **`GazetteITWatch`** runs
`node index.js` every hour indefinitely, working directory set to this
project folder. Created with:

```powershell
$action = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument 'index.js' -WorkingDirectory 'D:\Runbaa Tech\Gazette App'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'GazetteITWatch' -Action $action -Trigger $trigger -Settings $settings -Description 'Checks gazette.gov.mv for new IT/software/dev posts and notifies via Telegram'
```

Manage it via Windows Task Scheduler GUI, or:
- Check status: `Get-ScheduledTask -TaskName 'GazetteITWatch'`
- Run immediately: `Start-ScheduledTask -TaskName 'GazetteITWatch'`
- Disable: `Disable-ScheduledTask -TaskName 'GazetteITWatch'`
- Remove entirely: `Unregister-ScheduledTask -TaskName 'GazetteITWatch'`

Runs only while this Windows user is logged in (`LogonType: Interactive`) —
it does not run if the machine is fully logged out, only if locked/idle.

## Deployed to Netlify (cloud, runs without your PC on)

**Live.** Site: `gazettemv` (`https://gazettemv.netlify.app`), deployed from
`https://github.com/vvmode/gazette` (`main` branch, auto-deploys on push).
`netlify/functions/gazette-watch.js` is a `schedule("@hourly", ...)` function
from `@netlify/functions` calling the same `src/run.js` used locally;
`netlify.toml` points Netlify at the `netlify/functions` directory. Netlify
confirmed `Scheduling functions: gazette-watch` on deploy, so it's running
hourly in the cloud now.

Environment variables set in Netlify (Site settings → Environment variables,
all scope "All scopes", same value for all deploy contexts):
`GAZETTE_API_BASE_URL`, `GAZETTE_CLIENT_ID`, `GAZETTE_CLIENT_SECRET`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `DATABASE_URL`.

Note on `DATABASE_URL`: the site *is* linked to a Netlify Database (confirmed
by "No pending database migrations" / "Database snapshot created" in the
build log), but the auto-injected `NETLIFY_DATABASE_URL` wasn't actually
reaching the function at runtime for this site — first deploy failed with
`DATABASE_URL (or NETLIFY_DATABASE_URL) is not set`. Fix was to just add
`DATABASE_URL` manually as a regular env var with the same Postgres
connection string used locally. `src/store.js` checks
`DATABASE_URL || NETLIFY_DATABASE_URL`, so this works regardless of why the
auto-injection didn't apply here.

Note on timeouts: the first deploy also hit `502`/`499` errors on every
invocation (visible in the Functions log as long-running, ~15-40s requests
that never returned in time). Cause: `src/scraper.js` was firing its ~13
requests **sequentially** with a 500ms politeness delay between each,
totaling 20-30+ seconds — too slow for Netlify's function gateway. Fixed by
running them concurrently with `Promise.all`, which cut total run time to
~12-16s.

That fix wasn't enough on its own — after it shipped, the Functions log
still showed a ~38.67% error rate, almost all `499`s at a very consistent
~14970-14989ms, specifically on the scheduler's own `POST`-triggered
invocations (manual `GET` invocations succeeded even at 15-16.5s). Two
compounding causes, both fixed:

1. `getPosts()` in `src/run.js` was still trying the official API first on
   every run (OAuth token fetch + a guaranteed-500 request) before falling
   back to the scraper - pure wasted latency for an API that has 500'd on
   every single test since this project started. Removed; `run.js` now
   scrapes directly. (`src/gazetteClient.js` and `src/filter.js` are kept
   around unused, in case the API ever gets fixed and this is worth
   revisiting - see the "Gazette API" section above.)
2. The Gazette site's response time under ~13-way concurrent load turned out
   to be highly variable and load-dependent on their end - measured tail
   latency for the same batch of requests ranged from ~6s to ~14s across
   different attempts a few minutes apart, so no fixed per-request timeout
   or concurrency count could be reliably tuned against it.

Also switched `sendTelegramMessage` in `src/telegram.js` to send to all
recipients concurrently instead of sequentially.

First attempt at (2) raced the whole ~13-query batch against a single
`GLOBAL_DEADLINE_MS`, returning whatever had completed so far once it
passed. This didn't hold up: an 8s deadline turned out too tight to let
*any* query finish under the site's load, so runs "succeeded" (200) but
silently found nothing every time; raising it to 12s got real results back
but pushed total run time to ~14.7s - barely under the ceiling again, one
slow DB/Telegram round trip away from tipping back into failures.

**Current approach**: don't shrink the deadline, shrink the batch.
`src/scraper.js` now searches only **one keyword per run** (plus the
job-category URL, which always runs) - `currentSearchQuery()` picks it by
rotating through `SEARCH_QUERIES` on a wall-clock `ROTATION_MS` (10 min)
window, so which keyword runs is deterministic from `Date.now()` alone, no
persisted rotation state needed, and it stays correct even if a run is
skipped or retried. `netlify/functions/gazette-watch.js` schedule changed
from `@hourly` to `*/10 * * * *` to match: 12 keywords * 10 minutes = full
keyword coverage every 2 hours. Each run now only ever fires 2 concurrent
requests total, comfortably inside `GLOBAL_DEADLINE_MS` (9s) with room to
spare - a missed/slow keyword just gets retried on its next 2-hour turn,
and (as before) nothing is marked "seen" in Postgres until actually
fetched, so no post is silently skipped, only delayed.

Was already seeded from local runs against the same shared Postgres table
before going live, so the first real cloud invocation correctly reported
0 new posts instead of re-notifying about everything currently open.

Since local Task Scheduler and Netlify both write to the same Postgres
`seen_posts` table, running both at once is safe (not double-notifying) —
but there's no reason to run both long-term. Netlify is now primary; the
Task Scheduler job can be disabled with
`Disable-ScheduledTask -TaskName 'GazetteITWatch'` to avoid duplicate scrape
traffic against the Gazette site.
