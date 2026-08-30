import { resolve } from "node:path";
import { verifyVendoredRustPackages } from "./vendored-rust-contract.mjs";

let root = resolve(import.meta.dirname, "..");
let json = false;
try {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--json") json = true;
    else if (args[index] === "--root" && args[index + 1])
      root = resolve(args[++index]);
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  const records = verifyVendoredRustPackages(root);
  if (json) {
    console.log(
      JSON.stringify(
        records.map((record) => ({
          name: record.name,
          version: record.version,
          metadataSha256: record.metadataSha256,
          treeSha256: record.treeSha256,
          declaredLicense: record.declaredLicense,
          registryPackage: record.registryPackage,
          patchedAdvisories: record.patchedAdvisories,
        })),
        null,
        2,
      ),
    );
  } else {
    console.log(
      `Verified ${records.length} vendored Rust package(s), including all source files, patches and licenses.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
