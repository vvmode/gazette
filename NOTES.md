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

## Deploying to Netlify (cloud, runs without your PC on)

Code for this already exists: `netlify/functions/gazette-watch.js` (a
`schedule("@hourly", ...)` function from `@netlify/functions`, calling the
same `src/run.js` used locally) and `netlify.toml` (points Netlify at the
`netlify/functions` directory). Repo is already pushed to
`https://github.com/vvmode/gazette`.

To finish deploying (requires the Netlify dashboard/CLI, not doable from
here):
1. In Netlify, create a new site from the `vvmode/gazette` GitHub repo (or
   `netlify init` from this folder if using the CLI).
2. Link the site to the Netlify Database that already provides the
   `DATABASE_URL` in use locally — per Netlify's own message, functions on a
   linked site get `NETLIFY_DATABASE_URL` injected automatically, so
   `src/store.js` (which checks `DATABASE_URL || NETLIFY_DATABASE_URL`) needs
   no extra config for this one.
3. In Site settings → Environment variables, set: `GAZETTE_API_BASE_URL`,
   `GAZETTE_CLIENT_ID`, `GAZETTE_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID` (same values as local `.env`).
4. Deploy. Netlify auto-detects the `schedule()`-wrapped function and runs it
   hourly (cron `@hourly`) — no manual cron setup needed, unlike Task
   Scheduler.
5. Run the seed step once against production before relying on it, so the
   first live run doesn't re-notify about everything currently open: either
   trigger the function once manually from the Netlify UI after temporarily
   changing it to call `run({ seed: true })`, or just run `npm run seed`
   locally with production's env vars (it writes to the same shared Postgres
   table regardless of where it runs from).

Since local Task Scheduler and Netlify both write to the same Postgres
`seen_posts` table, running both at once is safe (not double-notifying) —
but there's no reason to run both long-term. Recommended: use Netlify as the
primary once deployed, and disable the Task Scheduler job
(`Disable-ScheduledTask -TaskName 'GazetteITWatch'`) to avoid duplicate
scrape traffic against the Gazette site.
