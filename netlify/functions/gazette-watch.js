import { schedule } from "@netlify/functions";
import { run } from "../../src/run.js";
import { closeStore } from "../../src/store.js";

// Three daily batches: 10 AM-noon, 1-3 PM, 10 PM-midnight
// Each batch runs every 10 minutes covering all 12 keywords
// (12 keywords * 10 minutes = 2 hours per batch)
// Total: 36 runs/day, 72 queries/day
// Runs at: 10-12 (AM), 13-15 (1-3 PM), 22-24 (10 PM-midnight)
export const handler = schedule("*/10 10-11,13-14,22-23 * * *", async () => {
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
