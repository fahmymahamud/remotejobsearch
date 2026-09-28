import { XMLParser } from "fast-xml-parser";
import type { Job, SourceResult } from "./types.js";
import { parseAgeHours, stripHtml, timeAgo } from "./text.js";

const UA = "ai-remote-job-digest/1.0 (personal job alert; github.com/fahmymahamud)";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/** Some APIs send unix seconds, others milliseconds. */
function fromUnix(n: number): Date {
  return new Date(n < 1e12 ? n * 1000 : n);
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches location text that a remote worker in `country` can apply to. */
export function openTo(country: string): RegExp {
  return new RegExp(`${escRe(country)}|asia|apac|worldwide|anywhere|global`, "i");
}

async function safe(name: string, fn: () => Promise<SourceResult>): Promise<SourceResult> {
  try {
    return await fn();
  } catch (err) {
    return { name, fetched: 0, jobs: [], error: String(err instanceof Error ? err.message : err) };
  }
}

// ---------------------------------------------------------------------------
// Himalayas — remote jobs, filtered server-side to roles open to residents of `country`.
// Terms: link back to Himalayas and credit it as the source.
// ---------------------------------------------------------------------------
type HimalayasJob = {
  title: string;
  companyName: string;
  excerpt?: string;
  categories?: string[];
  pubDate: number;
  applicationLink: string;
  guid: string;
  locationRestrictions?: string[];
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string;
};

export function himalayas(keywords: string[], country: string): Promise<SourceResult> {
  return safe("Himalayas", async () => {
    const seen = new Set<string>();
    const jobs: Job[] = [];
    let fetched = 0;
    for (const q of keywords) {
      const url = `https://himalayas.app/jobs/api/search?${new URLSearchParams({ q, country, sort: "recent" })}`;
      const data = await getJson<{ jobs?: HimalayasJob[] }>(url);
      for (const j of data.jobs ?? []) {
        fetched++;
        if (seen.has(j.guid)) continue;
        seen.add(j.guid);
        const d = fromUnix(j.pubDate);
        const loc = j.locationRestrictions?.length ? j.locationRestrictions.join(", ") : "Worldwide";
        jobs.push({
          title: j.title,
          company: j.companyName,
          location: loc,
          source: "Himalayas",
          url: j.applicationLink || j.guid,
          postedAt: d,
          postedLabel: timeAgo(d),
          text: `${j.title} ${(j.categories ?? []).join(" ").replace(/-/g, " ")} ${j.excerpt ?? ""}`,
          salary: j.minSalary && j.maxSalary ? `${j.currency ?? ""} ${j.minSalary}-${j.maxSalary}`.trim() : undefined,
        });
      }
    }
    return { name: "Himalayas", fetched, jobs };
  });
}

// ---------------------------------------------------------------------------
// Jobicy — remote jobs for the APAC region. Terms: credit Jobicy, link to the original job URL.
// Fair use: poll at most once an hour (we run once a day).
// ---------------------------------------------------------------------------
type JobicyJob = {
  url: string;
  jobTitle: string;
  companyName: string;
  jobIndustry?: string[];
  jobGeo?: string;
  jobExcerpt?: string;
  pubDate: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
};

export function jobicy(geo: string, country: string): Promise<SourceResult> {
  return safe("Jobicy", async () => {
    const data = await getJson<{ jobs?: JobicyJob[] }>(`https://jobicy.com/api/v2/remote-jobs?${new URLSearchParams({ count: "100", geo })}`);
    const list = data.jobs ?? [];
    const jobs: Job[] = list
      // Regional listings are sometimes country-specific (e.g. "China", "Australia"): keep only ones `country` can apply to.
      .filter((j) => openTo(country).test(j.jobGeo ?? ""))
      .map((j) => {
        const d = new Date(j.pubDate);
        return {
          title: stripHtml(j.jobTitle),
          company: j.companyName,
          location: j.jobGeo ?? geo,
          source: "Jobicy",
          url: j.url,
          postedAt: d,
          postedLabel: timeAgo(d),
          text: `${j.jobTitle} ${(j.jobIndustry ?? []).join(" ")} ${stripHtml(j.jobExcerpt ?? "")}`,
          salary: j.salaryMin && j.salaryMax ? `${j.salaryCurrency ?? ""} ${j.salaryMin}-${j.salaryMax}`.trim() : undefined,
        };
      });
    return { name: "Jobicy", fetched: list.length, jobs };
  });
}

// ---------------------------------------------------------------------------
// Remote OK — remote tech jobs. Terms: link back to the Remote OK URL and mention Remote OK.
// First array element is a legal notice, not a job.
// ---------------------------------------------------------------------------
type RemoteOkJob = {
  position?: string;
  company?: string;
  epoch?: number;
  location?: string;
  tags?: string[];
  url?: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
};

export function remoteOk(country: string): Promise<SourceResult> {
  return safe("Remote OK", async () => {
    const data = await getJson<RemoteOkJob[]>("https://remoteok.com/api");
    const list = data.filter((j) => j.position && j.url);
    const jobs: Job[] = list
      // Empty location = no restriction stated. Otherwise it must mention `country`/Asia/worldwide.
      .filter((j) => !j.location?.trim() || openTo(country).test(j.location))
      .map((j) => {
        const d = j.epoch ? fromUnix(j.epoch) : null;
        return {
          title: j.position!,
          company: j.company ?? "Unknown company",
          location: j.location?.trim() || "Worldwide",
          source: "Remote OK",
          url: j.url!,
          postedAt: d,
          postedLabel: d ? timeAgo(d) : "",
          text: `${j.position} ${(j.tags ?? []).join(" ")} ${stripHtml(j.description ?? "").slice(0, 3000)}`,
          salary: j.salary_min && j.salary_max ? `USD ${j.salary_min}-${j.salary_max}` : undefined,
        };
      });
    return { name: "Remote OK", fetched: list.length, jobs };
  });
}

// ---------------------------------------------------------------------------
// We Work Remotely — RSS. "Anywhere in the World" can still carry a <country> list
// (often Europe-only), so a listed country set must include `country`.
// ---------------------------------------------------------------------------
type WwrItem = {
  title?: string;
  region?: string;
  country?: string;
  category?: string;
  skills?: string;
  description?: string;
  pubDate?: string;
  link?: string;
};

export function weWorkRemotely(country: string): Promise<SourceResult> {
  return safe("We Work Remotely", async () => {
    const xml = await getText("https://weworkremotely.com/remote-jobs.rss");
    const parsed = new XMLParser({ ignoreAttributes: true }).parse(xml);
    const raw = parsed?.rss?.channel?.item ?? [];
    const items: WwrItem[] = Array.isArray(raw) ? raw : [raw];
    const jobs: Job[] = items
      .filter((i) => {
        const listed = String(i.country ?? "").trim();
        if (listed) return new RegExp(escRe(country), "i").test(listed);
        return openTo(country).test(String(i.region ?? ""));
      })
      .map((i) => {
        // WWR titles look like "Company: Job title"
        const full = String(i.title ?? "");
        const idx = full.indexOf(": ");
        const company = idx > 0 ? full.slice(0, idx) : "Unknown company";
        const title = idx > 0 ? full.slice(idx + 2) : full;
        const d = i.pubDate ? new Date(i.pubDate) : null;
        return {
          title,
          company,
          location: String(i.region ?? "Anywhere"),
          source: "We Work Remotely",
          url: String(i.link ?? ""),
          postedAt: d,
          postedLabel: d ? timeAgo(d) : "",
          text: `${title} ${i.category ?? ""} ${i.skills ?? ""} ${stripHtml(String(i.description ?? "")).slice(0, 3000)}`,
        };
      });
    return { name: "We Work Remotely", fetched: items.length, jobs };
  });
}

// ---------------------------------------------------------------------------
// Google Jobs via SerpAPI (LinkedIn, Indeed, JobStreet, MyCareersFuture, ...).
// Only runs when SERPAPI_API_KEY is set. Free plan = 250 searches/month.
// ---------------------------------------------------------------------------
type SerpJob = {
  title?: string;
  company_name?: string;
  location?: string;
  via?: string;
  description?: string;
  share_link?: string;
  detected_extensions?: { posted_at?: string; work_from_home?: boolean; salary?: string };
  apply_options?: { link?: string }[];
};

export function googleJobs(opts: {
  apiKey: string;
  queries: string[];
  location: string;
  gl: string;
  sites: string[]; // optional allowlist matched against "via"
}): Promise<SourceResult> {
  return safe("Google Jobs", async () => {
    const jobs: Job[] = [];
    let fetched = 0;
    for (const q of opts.queries) {
      const url = `https://serpapi.com/search.json?${new URLSearchParams({
        engine: "google_jobs",
        q,
        location: opts.location,
        gl: opts.gl,
        hl: "en",
        api_key: opts.apiKey,
      })}`;
      const res = await fetch(url);
      const body = (await res.json()) as { jobs_results?: SerpJob[]; error?: string };
      if (body.error && !/hasn't returned any results/i.test(body.error)) throw new Error(body.error);
      for (const r of body.jobs_results ?? []) {
        fetched++;
        const site = (r.via ?? "").replace(/^via\s+/i, "").trim() || "Google Jobs";
        if (opts.sites.length && !opts.sites.some((s) => site.toLowerCase().includes(s))) continue;
        const remote =
          r.detected_extensions?.work_from_home || /remote|work from home|anywhere|wfh/i.test(`${r.title} ${r.location}`);
        if (!remote) continue;
        const age = parseAgeHours(r.detected_extensions?.posted_at);
        jobs.push({
          title: r.title ?? "Untitled",
          company: r.company_name ?? "Unknown company",
          location: r.location ?? "",
          source: site,
          url: r.apply_options?.[0]?.link ?? r.share_link ?? "",
          // Google gives "N hours ago" text; approximate a timestamp so all sources share one freshness rule.
          postedAt: age === null ? null : new Date(Date.now() - age * 3_600_000),
          postedLabel: r.detected_extensions?.posted_at ?? "",
          text: `${r.title} ${(r.description ?? "").slice(0, 3000)}`,
          salary: r.detected_extensions?.salary,
        });
      }
    }
    return { name: "Google Jobs", fetched, jobs };
  });
}
