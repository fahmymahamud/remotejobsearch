# AI Remote Job Digest

A scheduled Trigger.dev task. Every day at **8:00am SGT** it collects remote jobs that people in **Singapore** can apply for, keeps AI / data / automation / web roles, ranks them against my resume skills, and sends the top matches to **Telegram**.

```
Trigger.dev cron (8am SGT)
  → Himalayas (country = Singapore) · Jobicy (APAC) · Remote OK · We Work Remotely · Google Jobs (optional, SerpAPI)
  → keep remote roles open to Singapore → keep my role types → keep only new since last run
  → dedupe across sites → score against resume keywords → Telegram (top 15)
```

## Sources
| Site | How | Singapore filter | Terms |
|---|---|---|---|
| Himalayas | Search API `himalayas.app/jobs/api/search` | `country=Singapore` (server-side) | Credit + link back to Himalayas |
| Jobicy | `jobicy.com/api/v2/remote-jobs?geo=apac` | Drops country-locked APAC jobs (e.g. "China") | Credit Jobicy, link to original URL; ≤ 1 call/hour |
| Remote OK | `remoteok.com/api` | Empty location or Asia/Worldwide | Credit + link back to Remote OK |
| We Work Remotely | RSS `weworkremotely.com/remote-jobs.rss` | If a `<country>` list exists it must include Singapore | — |
| Google Jobs | SerpAPI `google_jobs` (only if `SERPAPI_API_KEY` is set) | Remote flag / "remote" text | 250 free searches/month; this uses ~120 |

Every Telegram message lists each site with a funnel: `checked → remote/SG-OK → your roles → new`, so an empty day shows exactly where jobs dropped out.

## Environment variables (Trigger.dev → Environment Variables → Production)
| Name | Required | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | @BotFather → `/newbot` |
| `TELEGRAM_CHAT_ID` | yes | Message the bot, then read `chat.id` from `https://api.telegram.org/bot<TOKEN>/getUpdates` |
| `SERPAPI_API_KEY` | no | Turns on Google Jobs |
| `RESUME_KEYWORDS` | no | Pipe-separated skills to rank by (defaults to my resume: Python, SQL, Azure, GCP, Snowflake, Databricks, n8n, Supabase, ...) |
| `ROLE_KEYWORDS` | no | Pipe-separated title words a job must match (AI, data engineer, automation, full stack, ...) |
| `HIMALAYAS_QUERIES` | no | Pipe-separated searches (default: data engineer, ai engineer, machine learning, automation, full stack) |
| `JOB_QUERIES`, `JOB_SOURCES`, `JOB_LOCATION`, `JOB_GL` | no | Google Jobs searches, site allowlist (e.g. `LinkedIn|Indeed|MyCareersFuture`), location, country |
| `LOOKBACK_HOURS` | no | Test aid: e.g. `72` shows the last 3 days instead of "since last run". Remove after testing |
| `MAX_RESULTS` | no | Jobs per digest (default 15) |

## Deploy
```powershell
npm install
npx trigger.dev@4.6.4 deploy
```
Then Trigger.dev → Test → `ai-remote-job-digest` → Run.

## Design notes
- **"New" without a database:** uses the schedule's `lastTimestamp`, so each run shows only jobs posted since the previous run.
- **One bad source never kills the digest:** each site is fetched independently and failures are listed in the message.
- **Senior titles (Head/Director/Staff/Principal) are ranked lower**, not hidden.
- Himalayas' `pubDate` is Unix **seconds** even though its docs say milliseconds; the code handles both.
