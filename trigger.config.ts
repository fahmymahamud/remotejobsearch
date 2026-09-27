import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Trigger.dev project ref
  project: "proj_eqceyporhtgxiclevsae",
  dirs: ["./trigger"],
  maxDuration: 120,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000, factor: 2 },
  },
});
