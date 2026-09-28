export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function timeAgo(d: Date, now = new Date()): string {
  const h = (now.getTime() - d.getTime()) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)} hour${Math.floor(h) === 1 ? "" : "s"} ago`;
  const days = Math.floor(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Google shows "5 hours ago", "1 day ago", "30+ days ago". Returns hours, or null if unknown. */
export function parseAgeHours(postedAt?: string): number | null {
  if (!postedAt) return null;
  const lower = postedAt.toLowerCase();
  const m = lower.match(/(\d+)\+?\s*(minute|hour|day|week|month)/);
  if (!m) return /just posted|today/.test(lower) ? 0 : null;
  const perUnit: Record<string, number> = { minute: 1 / 60, hour: 1, day: 24, week: 168, month: 720 };
  return Number(m[1]) * perUnit[m[2]];
}
