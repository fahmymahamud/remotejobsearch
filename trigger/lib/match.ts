import type { Job } from "./types.js";

// Roles to consider at all (title must match one). Override with ROLE_KEYWORDS (pipe-separated).
export const DEFAULT_ROLE_KEYWORDS = [
  "ai",
  "artificial intelligence",
  "machine learning",
  "ml",
  "llm",
  "genai",
  "data engineer",
  "data engineering",
  "analytics engineer",
  "data platform",
  "etl",
  "data analyst",
  "automation",
  "integration",
  "web developer",
  "full stack",
  "full-stack",
  "frontend",
  "front-end",
  "backend",
  "back-end",
  "software engineer",
  "python",
  "cloud engineer",
  "solutions engineer",
];

// Resume skills used to rank jobs. Override with RESUME_KEYWORDS (pipe-separated).
export const DEFAULT_RESUME_KEYWORDS = [
  "python",
  "sql",
  "azure",
  "gcp",
  "google cloud",
  "snowflake",
  "databricks",
  "microsoft fabric",
  "power bi",
  "etl",
  "data pipeline",
  "data warehouse",
  "generative ai",
  "genai",
  "llm",
  "rag",
  "mcp",
  "n8n",
  "automation",
  "workflow",
  "api",
  "integration",
  "supabase",
  "firebase",
  "cloud run",
  "javascript",
  "typescript",
  "html",
  "servicenow",
  "analytics",
];

// Too senior for where Fahmy is now — pushed down, not hidden.
const SENIOR = /\b(head of|director|vp|vice president|principal|staff|chief)\b/i;

function wordMatch(haystack: string, kw: string): boolean {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

export function isRelevantRole(job: Job, roleKeywords: string[]): boolean {
  return roleKeywords.some((k) => wordMatch(job.title, k));
}

export type Scored = Job & { score: number; matched: string[] };

export function scoreJob(job: Job, resumeKeywords: string[]): Scored {
  const matched: string[] = [];
  let score = 0;
  for (const kw of resumeKeywords) {
    if (wordMatch(job.title, kw)) {
      score += 3;
      matched.push(kw);
    } else if (wordMatch(job.text, kw)) {
      score += 1;
      matched.push(kw);
    }
  }
  if (SENIOR.test(job.title)) score -= 4;
  return { ...job, score, matched };
}
