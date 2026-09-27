import { logger, schedules } from "@trigger.dev/sdk";

// ---------- Config (all overridable via Trigger.dev environment variables) ----------
const DEFAULT_QUERIES = [
  "AI engineer remote",
  "AI automation engineer remote",
  "machine learning engineer remote",
  "data engineer AI remote",
];

// SerpAPI free plan = 250 searches/month. 4 queries x 1/day ~= 120/month, leaving room for tests.
const queries = (process.env.JOB_QUERIES ?? DEFAULT_QUERIES.join("|"))
  .split("|")
  .map((q) => q.trim())
  .filter(Boolean);

const LOCATION = process.env.JOB_LOCATION ?? "Singapore";
const GL = process.env.JOB_GL ?? "sg";
const MAX_AGE_HOURS = Number(process.env.JOB_MAX_AGE_HOURS ?? 24);
const REMOTE_ONLY = (process.env.JOB_REMOTE_ONLY ?? "true") === "true";

// ---------- Types ----------
type SerpJob = {
  job_id?: string;
  title?: string;
  company_name?: string;
  location?: string;
  via?: string;
  description?: string;
  share_link?: string;
  detected_extensions?: {
    posted_at?: string;
    work_from_home?: boolean;
    schedule_type?: string;
    salary?: string;
  };
  apply_options?: { title?: string; link?: string }[];
};

type Job = {
  key: string;
  title: string;
  company: string;
  location: string;
  postedAt: string;
  ageHours: number;
  salary?: string;
  link: string;
  query: string;
};

// ---------- Helpers ----------
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Google shows "5 hours ago", "1 day ago", "30+ days ago". Returns hours, or null if unknown. */
export function parseAgeHours(postedAt?: string): number | null {
  if (!postedAt) return null;
  const m = postedAt.toLowerCase().match(/(\d+)\+?\s*(minute|hour|day|week|month)/);
  if (!m) return /just posted|today/.test(postedAt.toLowerCase()) ? 0 : null;
  const n = Number(m[1]);
  const perUnit: Record<string, number> = { minute: 1 / 60, hour: 1, day: 24, week: 168, month: 720 };
  return n * perUnit[m[2]];
}

export function isRemote(j: SerpJob): boolean {
  if (j.detected_extensions?.work_from_home) return true;
  const hay = `${j.title ?? ""} ${j.location ?? ""}`.toLowerCase();
  return /remote|work from home|anywhere|wfh/.test(hay);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function searchJobs(query: string, apiKey: string): Promise<SerpJob[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.search = new URLSearchParams({
    engine: "google_jobs",
    q: query,
    location: LOCATION,
    gl: GL,
    hl: "en",
    api_key: apiKey,
  }).toString();

  const res = await fetch(url);
  const body = (await res.json()) as { jobs_results?: SerpJob[]; error?: string };
  // SerpAPI returns an "error" field (not an HTTP error) when a search simply has no results.
  if (body.error) {
    if (/hasn't returned any results/i.test(body.error)) return [];
    throw new Error(`SerpAPI error for "${query}": ${body.error}`);
  }
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status} for "${query}"`);
  return body.jobs_results ?? [];
}

async function sendTelegram(text: string, token: string, chatId: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
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

// ---------- The scheduled task ----------
export const aiRemoteJobDigest = schedules.task({
  id: "ai-remote-job-digest",
  cron: { pattern: "0 8 * * *", timezone: "Asia/Singapore" }, // every day 8:00am SGT
  maxDuration: 120,
  run: async (payload) => {
    const serpKey = requireEnv("SERPAPI_API_KEY");
    const tgToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const tgChat = requireEnv("TELEGRAM_CHAT_ID");

    const seen = new Set<string>();
    const jobs: Job[] = [];
    const failures: string[] = [];
    let raw = 0;

    for (const query of queries) {
      let results: SerpJob[] = [];
      try {
        results = await searchJobs(query, serpKey);
      } catch (err) {
        logger.error("Search failed", { query, err: String(err) });
        failures.push(query);
        continue;
      }
      raw += results.length;

      for (const r of results) {
        if (REMOTE_ONLY && !isRemote(r)) continue;
        const age = parseAgeHours(r.detected_extensions?.posted_at);
        // Only postings Google labels "N hours ago" (< 24h). With a daily run, each job lands in exactly
        // one digest; "1 day ago" covers 24-47h and would repeat yesterday's jobs.
        if (age === null || age >= MAX_AGE_HOURS) continue;

        // Same job often appears under several queries/boards: dedupe on title+company.
        const key = `${(r.title ?? "").toLowerCase().trim()}|${(r.company_name ?? "").toLowerCase().trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        jobs.push({
          key,
          title: r.title ?? "Untitled",
          company: r.company_name ?? "Unknown company",
          location: r.location ?? "",
          postedAt: r.detected_extensions?.posted_at ?? "",
          ageHours: age,
          salary: r.detected_extensions?.salary,
          link: r.apply_options?.[0]?.link ?? r.share_link ?? "",
          query,
        });
      }
    }

    jobs.sort((a, b) => a.ageHours - b.ageHours);
    logger.info("Digest built", { queries: queries.length, raw, kept: jobs.length, failures });

    const date = new Date(payload.timestamp).toLocaleDateString("en-SG", {
      timeZone: "Asia/Singapore",
      weekday: "short",
      day: "numeric",
      month: "short",
    });

    if (jobs.length === 0) {
      await sendTelegram(
        `🤖 <b>AI remote jobs · ${date}</b>\nNo new remote postings in the last ${MAX_AGE_HOURS}h` +
          (failures.length ? `\n⚠️ Failed searches: ${esc(failures.join(", "))}` : ""),
        tgToken,
        tgChat,
      );
      return { kept: 0, raw, failures };
    }

    const blocks = jobs.map((j, i) => {
      const lines = [
        `<b>${i + 1}. ${esc(j.title)}</b>`,
        `🏢 ${esc(j.company)}${j.location ? ` · 📍 ${esc(j.location)}` : ""}`,
        `🕒 ${esc(j.postedAt)}${j.salary ? ` · 💰 ${esc(j.salary)}` : ""}`,
      ];
      if (j.link) lines.push(`<a href="${esc(j.link)}">Apply →</a>`);
      return lines.join("\n");
    });

    const header =
      `🤖 <b>AI remote jobs · ${date}</b>\n${jobs.length} new in the last ${MAX_AGE_HOURS}h` +
      (failures.length ? `\n⚠️ Failed searches: ${esc(failures.join(", "))}` : "");

    for (const msg of chunkMessages(header, blocks)) {
      await sendTelegram(msg, tgToken, tgChat);
    }

    return { kept: jobs.length, raw, failures };
  },
});
