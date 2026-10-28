import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { isVerifiedZodFinding } from "./vendored-zod-audit.mjs";

// A reviewed exact graph, including independently low-severity deepmerge paths.
// Never modify raw npm output or recognize any changed advisory or graph edge.
const expected = JSON.parse(readFileSync(new URL("./zod-expo-audit-20261028.fixture.json", import.meta.url), "utf8"));
export function isVerifiedNpmBackportFinding(report, name, { zod }) {
  if (!zod || !["zod", "@expo/cli", "expo"].includes(name)) return false;
  if (!isVerifiedZodFinding(report, "zod", zod)) return false;
  return Object.entries(expected).every(([key, finding]) =>
    isDeepStrictEqual(report.vulnerabilities?.[key], finding));
}
