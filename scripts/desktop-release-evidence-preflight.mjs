const FORMAL_SIGNING_DISABLED = "FORMAL_SIGNING_DISABLED";
const args = process.argv.slice(2);

if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log(`Desktop formal signing automation is disabled.

This compatibility guard does not inspect GitHub environments, verify signing
material, or dispatch a workflow. A future formal release must use an approved
externally managed isolated signer and an independently verified evidence
handoff.`);
  process.exit(0);
}

console.error(
  `${FORMAL_SIGNING_DISABLED}: Desktop formal signing preflight and dispatch are disabled.`,
);
console.error(
  "No repository secret inventory, GitHub environment access, or signing workflow dispatch is available.",
);
console.error(
  "Use only a future approved externally managed isolated signer; historical offline evidence verification tools do not form a runnable signing chain.",
);
process.exit(1);
