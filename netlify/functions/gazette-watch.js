import { schedule } from "@netlify/functions";
import { run } from "../../src/run.js";
import { closeStore } from "../../src/store.js";

// Two daily batches during business hours only: 10 AM-noon, 1-3 PM
// Each batch runs every 10 minutes covering all 12 keywords
// (12 keywords * 10 minutes = 2 hours per batch)
// Total: 24 runs/day, 48 queries/day
// Runs at: 10-11 (AM), 13-14 (1-3 PM)
export const handler = schedule("*/10 10-11,13-14 * * *", async () => {
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
