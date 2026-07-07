import { schedule } from "@netlify/functions";
import { run } from "../../src/run.js";
import { closeStore } from "../../src/store.js";

// Every 10 minutes, not hourly - src/scraper.js rotates through one search
// keyword per run by wall-clock time (12 keywords * 10 minutes = full
// coverage every 2 hours), so each individual run only ever fires 2
// concurrent requests (job-category + one keyword), keeping it well within
// Netlify's scheduled-invocation time ceiling.
export const handler = schedule("*/10 * * * *", async () => {
  try {
    const result = await run();
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error("Gazette watch run failed:", err);
    return { statusCode: 500, body: err.message };
  } finally {
    await closeStore();
  }
});
