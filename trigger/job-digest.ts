import { logger, schedules } from "@trigger.dev/sdk";
import { googleJobs, himalayas, jobicy, remoteOk, weWorkRemotely } from "./lib/sources.js";
import { DEFAULT_RESUME_KEYWORDS, DEFAULT_ROLE_KEYWORDS, isRelevantRole, scoreJob, type Scored } from "./lib/match.js";
import { esc } from "./lib/text.js";
import type { SourceResult } from "./lib/types.js";

// ---------- Config (all overridable via Trigger.dev environment variables) ----------
const list = (v: string | undefined, fallback: string[]) =>
  v ? v.split("|").map((x) => x.trim().toLowerCase()).filter(Boolean) : fallback;

const cfg = () => ({
  roleKeywords: list(process.env.ROLE_KEYWORDS, DEFAULT_ROLE_KEYWORDS),
  resumeKeywords: list(process.env.RESUME_KEYWORDS, DEFAULT_RESUME_KEYWORDS),
  himalayasQueries: list(process.env.HIMALAYAS_QUERIES, [
    "data engineer",
    "ai engineer",
    "machine learning",
    "automation",
    "full stack",
  ]),
  // Google Jobs (via SerpAPI) is optional: 4 searches/day ≈ 120 of the 250 free monthly searches.
  googleQueries: list(process.env.JOB_QUERIES, [
    "ai engineer remote",
    "ai automation engineer remote",
    "machine learning engineer remote",
    "data engineer ai remote",
  ]),
  googleSites: list(process.env.JOB_SOURCES, []),
  // Country you live in: remote jobs must be open to it. Also used as the Google Jobs location.
  country: process.env.JOB_COUNTRY ?? "Singapore",
  // Jobicy region slug: apac, emea, latam, usa, canada, europe, ...
  jobicyGeo: process.env.JOBICY_GEO ?? "apac",
  location: process.env.JOB_LOCATION ?? process.env.JOB_COUNTRY ?? "Singapore",
  gl: process.env.JOB_GL ?? "sg",
  // Normally "new since the last scheduled run". Set LOOKBACK_HOURS (e.g. 72) to widen it for testing.
  lookbackHours: process.env.LOOKBACK_HOURS ? Number(process.env.LOOKBACK_HOURS) : null,
  maxResults: Number(process.env.MAX_RESULTS ?? 15),
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

async function sendTelegram(text: string, token: string, chatId: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
}

/** Telegram caps a message at 4096 chars, so split on job boundaries. */
function chunkMessages(header: string, blocks: string[], limit = 3800): string[] {
  const out: string[] = [];
  let cur = header;
  for (const b of blocks) {
    if ((cur + "\n\n" + b).length > limit) {
      out.push(cur);
      cur = b;
    } else {
      cur += "\n\n" + b;
    }
  }
  out.push(cur);
  return out;
}

// ---------- Core logic (exported so it can be tested without Trigger.dev) ----------
export async function runDigest(payload: { timestamp: Date; lastTimestamp?: Date }) {
  const c = cfg();
  const tgToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const tgChat = requireEnv("TELEGRAM_CHAT_ID");
  const serpKey = process.env.SERPAPI_API_KEY;

  const now = new Date(payload.timestamp);
  const cutoff = c.lookbackHours
    ? new Date(now.getTime() - c.lookbackHours * 3_600_000)
    : payload.lastTimestamp
      ? new Date(payload.lastTimestamp)
      : new Date(now.getTime() - 24 * 3_600_000);

  // 1. Fetch every source in parallel. One failing source never stops the digest.
  const sources: SourceResult[] = await Promise.all([
    himalayas(c.himalayasQueries, c.country),
    jobicy(c.jobicyGeo, c.country),
    remoteOk(c.country),
    weWorkRemotely(c.country),
    ...(serpKey
      ? [googleJobs({ apiKey: serpKey, queries: c.googleQueries, location: c.location, gl: c.gl, sites: c.googleSites })]
      : []),
  ]);

  // 2. Per source: keep relevant roles posted since the cutoff.
  const stats = sources.map((s) => {
    const relevant = s.jobs.filter((j) => isRelevantRole(j, c.roleKeywords));
    const fresh = relevant.filter((j) => j.postedAt && j.postedAt > cutoff);
    return { s, eligible: s.jobs.length, relevant: relevant.length, fresh };
  });

  // 3. Dedupe across sources (same job is often posted on several boards), score against resume, rank.
  const seen = new Set<string>();
  const ranked: Scored[] = [];
  for (const st of stats) {
    for (const j of st.fresh) {
      const key = `${j.title.toLowerCase().replace(/\W+/g, " ").trim()}|${j.company.toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranked.push(scoreJob(j, c.resumeKeywords));
    }
  }
  ranked.sort((a, b) => b.score - a.score || (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0));
  const shown = ranked.slice(0, c.maxResults);

  logger.info("Digest built", {
    cutoff: cutoff.toISOString(),
    sources: stats.map((st) => ({
      name: st.s.name,
      fetched: st.s.fetched,
      remoteForCountry: st.eligible,
      relevantRoles: st.relevant,
      new: st.fresh.length,
      error: st.s.error,
    })),
    uniqueNew: ranked.length,
    shown: shown.length,
  });

  // 4. Build the Telegram message.
  const date = now.toLocaleDateString("en-SG", { timeZone: "Asia/Singapore", weekday: "short", day: "numeric", month: "short" });
  const sourceLines = stats.map((st) =>
    st.s.error
      ? `⚠️ ${esc(st.s.name)}: failed (${esc(st.s.error.slice(0, 60))})`
      : `• ${esc(st.s.name)}: ${st.s.fetched} checked → ${st.eligible} open to ${esc(c.country)} → ${st.relevant} your roles → <b>${st.fresh.length} new</b>`,
  );
  const header =
    `🤖 <b>Remote jobs for you · ${date}</b>\n` +
    (ranked.length
      ? `🆕 ${ranked.length} new since last run${ranked.length > shown.length ? ` · top ${shown.length} by resume match` : ""}`
      : `No new matching jobs since last run`) +
    `\n\n🌐 <b>Sites checked</b>\n${sourceLines.join("\n")}`;

  const blocks = shown.map((j, i) => {
    const lines = [
      `<b>${i + 1}. ${esc(j.title)}</b>`,
      `🏢 ${esc(j.company)}${j.location ? ` · 📍 ${esc(j.location.slice(0, 60))}` : ""}`,
      `🕒 ${esc(j.postedLabel)} · 🌐 via ${esc(j.source)}${j.salary ? ` · 💰 ${esc(j.salary)}` : ""}`,
    ];
    if (j.matched.length) lines.push(`🎯 ${esc(j.matched.slice(0, 6).join(", "))}`);
    if (j.url) lines.push(`<a href="${esc(j.url)}">View on ${esc(j.source)} →</a>`);
    return lines.join("\n");
  });

  for (const msg of chunkMessages(header, blocks)) {
    await sendTelegram(msg, tgToken, tgChat);
  }

  return {
    cutoff: cutoff.toISOString(),
    new: ranked.length,
    shown: shown.length,
    // Full list of the jobs sent to Telegram, so other tools (e.g. CareerOS) can read today's digest via the Trigger.dev API.
    jobs: shown.map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      source: j.source,
      url: j.url,
      postedAt: j.postedAt ? j.postedAt.toISOString() : null,
      salary: j.salary ?? null,
      score: j.score,
      matched: j.matched,
    })),
    sources: stats.map((st) => ({ name: st.s.name, fetched: st.s.fetched, new: st.fresh.length, error: st.s.error })),
  };
}

// ---------- The scheduled task ----------
export const aiRemoteJobDigest = schedules.task({
  id: "ai-remote-job-digest",
  cron: { pattern: "0 8 * * *", timezone: "Asia/Singapore" }, // every day 8:00am SGT
  maxDuration: 180,
  run: async (payload) => runDigest(payload),
});
