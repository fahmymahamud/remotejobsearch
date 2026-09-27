# AI Remote Job Digest

A scheduled Trigger.dev task. Every day at **8:00am SGT** it searches Google Jobs (via SerpAPI) for fresh **remote AI roles**, drops anything that isn't remote or is older than 24h, dedupes, and sends the list to **Telegram**.

```
Trigger.dev cron (8am SGT) → SerpAPI google_jobs × 4 queries → filter remote + <24h → dedupe → Telegram
```

## Keys you need
| Env var | Where to get it |
|---|---|
| `SERPAPI_API_KEY` | serpapi.com → Dashboard → API key (free plan: 250 searches/month; this uses ~120) |
| `TELEGRAM_BOT_TOKEN` | Telegram → @BotFather → `/newbot` |
| `TELEGRAM_CHAT_ID` | Send your new bot any message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `message.chat.id` |

Optional: `JOB_QUERIES` (pipe-separated, e.g. `AI engineer remote|LLM engineer remote`), `JOB_LOCATION` (default `Singapore`), `JOB_GL` (default `sg`), `JOB_REMOTE_ONLY` (default `true`).

## Deploy from a phone (no laptop)
1. **Trigger.dev**: create a project. Copy its ref (`proj_...`) from Project settings into `trigger.config.ts`.
2. **Trigger.dev**: Account → Personal Access Tokens → create one (`tr_pat_...`).
3. **GitHub**: create a new repo `ai-remote-job-digest`. Add each file with *Add file → Create new file*. Typing a `/` in the file name makes a folder, e.g. `trigger/job-digest.ts` and `.github/workflows/deploy.yml`.
4. **GitHub**: Settings → Secrets and variables → Actions → New secret `TRIGGER_ACCESS_TOKEN` = the token from step 2.
5. **Trigger.dev**: Environment Variables → **Production** → add the 3 keys above.
6. **GitHub**: Actions → "Deploy to Trigger.dev (prod)" → Run workflow (or it runs automatically on the next commit).
7. **Trigger.dev**: Test → `ai-remote-job-digest` → Run. Check Telegram and the run logs.

## Design notes
- **No database needed for "new only".** Only postings Google labels "N hours ago" are kept. With one run a day, each job appears in exactly one digest.
- **Remote filter** uses Google's `work_from_home` flag or "remote/anywhere/WFH" in the title or location. SerpAPI's old `ltype` remote filter is deprecated.
- **Dedupe** on title + company, because the same job shows up across boards and queries.
- A failed search doesn't kill the run: the digest still sends and names the failed query.
- Telegram's 4096-character limit is handled by splitting on job boundaries.

## Local dev (laptop)
```bash
npm install
npx trigger.dev@4.6.4 login
npm run dev   # then trigger a test run from the dashboard
```
