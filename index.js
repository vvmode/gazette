process.loadEnvFile(".env");

import { run } from "./src/run.js";
import { closeStore } from "./src/store.js";

const isSeedRun = process.argv.includes("--seed");

run({ seed: isSeedRun })
  .catch((err) => {
    console.error("Gazette watch run failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeStore());
