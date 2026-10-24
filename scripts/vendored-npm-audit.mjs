import { isVerifiedNodeForgeFinding } from "./vendored-node-forge-audit.mjs";
import { isVerifiedZodFinding } from "./vendored-zod-audit.mjs";

// Call only after source verification and fresh original-identity audits.
// The raw report is evidence and must remain unchanged. This narrow composition
// handles Expo CLI's two independently repaired leaves without teaching the
// original forge matcher to ignore a new advisory or arbitrary parent edge.
export function isVerifiedNpmBackportFinding(report, name, { forge, zod }) {
  if (zod && isVerifiedZodFinding(report, name, zod)) return true;
  if (!forge) return false;
  if (isVerifiedNodeForgeFinding(report, name, forge)) return true;
  if (!zod) return false;

  const leaves = Object.keys(report.vulnerabilities).filter((key) =>
    isVerifiedZodFinding(report, key, zod),
  );
  if (leaves.length !== 1) return false;
  const leaf = leaves[0];
  const cli = report.vulnerabilities["@expo/cli"];
  if (
    !cli ||
    !Array.isArray(cli.via) ||
    cli.via.filter((edge) => edge === leaf).length !== 1
  ) {
    return false;
  }
  const projection = {
    ...report,
    vulnerabilities: {
      ...report.vulnerabilities,
      "@expo/cli": { ...cli, via: cli.via.filter((edge) => edge !== leaf) },
    },
  };
  return isVerifiedNodeForgeFinding(projection, name, forge);
}
