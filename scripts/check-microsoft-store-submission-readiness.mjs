import { resolve } from "node:path";
import { checkMicrosoftStoreSubmissionReadiness } from "./check-microsoft-store-localization.mjs";

const results = checkMicrosoftStoreSubmissionReadiness(
  resolve(import.meta.dirname, ".."),
);
for (const result of results) {
  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${result.label}: ${result.detail}`,
  );
}
if (results.some((result) => !result.passed)) process.exitCode = 1;
