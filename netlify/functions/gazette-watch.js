import { schedule } from "@netlify/functions";
import { run } from "../../src/run.js";
import { closeStore } from "../../src/store.js";

export const handler = schedule("@hourly", async () => {
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
