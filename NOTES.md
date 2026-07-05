# Gazette IT Job/Tender Bot

Monitors gazette.gov.mv for new postings and notifies (via Telegram) on
anything related to software/website/application development.

Node.js, zero npm dependencies (uses built-in `fetch` and
`process.loadEnvFile`). Requires Node >= 20.6.

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

## Pipeline (`index.js`)

1. Try the API; on any error, fall back to the scraper.
2. Compare `iulaan_id` against `data/seen-ids.json` (gitignored) — skip dupes.
3. For API-sourced posts only: apply the keyword/category filter in
   `src/filter.js`. Scrape-sourced posts are already filtered by the
   query URLs used, so this step is skipped for them.
4. Mark every fetched post as seen (whether matched or not) so nothing is
   re-evaluated on the next run.
5. Send a Telegram message per new match.

## First run: seed, don't spam

The scraper currently returns ~47 historical matches going back years. On a
truly first run there is nothing in `data/seen-ids.json`, so *everything*
would look "new" and trigger 47 Telegram messages at once.

Run once with `--seed` (or `npm run seed`) to mark all currently-found posts
as seen without sending any notifications. After that, `npm start` /
`node index.js` only notifies on posts that appear after the seed.

## Setup

1. Copy `.env.example` → already have `.env` with real Gazette API creds.
   Fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
2. `npm run seed` — one-time, marks existing posts as seen, no notifications.
3. `npm start` — normal run, notifies on anything new since the seed.
4. Schedule step 3 to run periodically (see below) — this is a one-shot
   script, not a long-running process.

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
