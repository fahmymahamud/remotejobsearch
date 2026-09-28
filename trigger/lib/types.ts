export type Job = {
  title: string;
  company: string;
  location: string; // human-readable eligibility, e.g. "Worldwide", "Singapore OK", "APAC"
  source: string; // shown as "via ..." — e.g. "Himalayas", "LinkedIn"
  url: string; // original posting URL (sites require linking back to them)
  postedAt: Date | null;
  postedLabel: string; // e.g. "5 hours ago"
  text: string; // title + tags + description, used for resume matching
  salary?: string;
};

export type SourceResult = {
  name: string; // "Himalayas", "Google Jobs", ...
  fetched: number; // total listings the site returned
  jobs: Job[]; // listings that passed the site's own eligibility filter (remote + open to Singapore)
  error?: string;
};
