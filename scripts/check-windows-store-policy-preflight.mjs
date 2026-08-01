import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import {
  assertWindowsLegalPublisher,
  validatePartnerCenterIdentity,
} from "./windows-store-contract.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const commercialCheckerPath = resolve(
  import.meta.dirname,
  "check-commercial-release-readiness.mjs",
);
const publicPageCheckerPath = resolve(
  import.meta.dirname,
  "check-store-public-pages.mjs",
);
const localIdentityDirectory = "reports/handoff/windows-store";
const sharedValueFlags = new Set(["--privacy-url", "--support-url"]);
const privateValueFlags = new Set(["--partner-identity"]);
const commercialBooleanFlags = new Set(["--confirm-public-links"]);
const identityFields = [
  "schemaVersion",
  "source",
  "productId",
  "packageIdentityName",
  "publisher",
  "publisherDisplayName",
  "publisherId",
  "packageFamilyName",
  "reservedAt",
];
const rejectedIndividualPublisherAliases = new Set([
  "joessh",
  "joessh community",
  "joessh project",
  "joeworkspace",
]);

export function routeStorePolicyPreflightArgs(args) {
  const commercialArgs = ["--mode", "store"];
  const publicPageArgs = [];
  const seen = new Set();
  let partnerIdentityPath = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.split(/=(.*)/s, 2);
    if (commercialBooleanFlags.has(flag)) {
      if (inlineValue !== undefined) {
        throw new Error(`${flag} does not accept a value.`);
      }
      assertNotRepeated(seen, flag);
      commercialArgs.push(flag);
      continue;
    }

    const shared = sharedValueFlags.has(flag);
    const privateOnly = privateValueFlags.has(flag);
    if (!shared && !privateOnly) {
      throw new Error(`Unknown Store policy preflight option: ${flag}`);
    }
    assertNotRepeated(seen, flag);
    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }
    if (privateOnly) {
      partnerIdentityPath = value;
      continue;
    }
    commercialArgs.push(flag, value);
    if (shared) {
      publicPageArgs.push(flag, value);
    }
  }

  if (!partnerIdentityPath) {
    throw new Error(
      "--partner-identity is required so Store publisher identity is loaded from the canonical private file.",
    );
  }

  return { commercialArgs, partnerIdentityPath, publicPageArgs };
}

export function runStorePolicyPreflight(
  args,
  {
    cwd = repositoryRoot,
    env = process.env,
    loadPartnerIdentityFn = loadPartnerIdentity,
    spawnSyncFn = spawnSync,
    stdio = "inherit",
  } = {},
) {
  const routed = routeStorePolicyPreflightArgs(args);
  const checkerEnv = { ...env };
  if (routed.partnerIdentityPath) {
    const identity = loadPartnerIdentityFn(routed.partnerIdentityPath, cwd);
    checkerEnv.JOESSH_SELLER_LEGAL_NAME = identity.publisherDisplayName;
    checkerEnv.ATLASTERM_WINDOWS_LEGAL_PUBLISHER =
      identity.publisherDisplayName;
  }
  const commercialResult = runChecker(
    spawnSyncFn,
    commercialCheckerPath,
    routed.commercialArgs,
    { cwd, env: checkerEnv, stdio },
    "commercial Store policy",
  );
  if (commercialResult !== 0) {
    return commercialResult;
  }
  return runChecker(
    spawnSyncFn,
    publicPageCheckerPath,
    routed.publicPageArgs,
    { cwd, env: checkerEnv, stdio },
    "logged-out public page",
  );
}

export function loadPartnerIdentity(requestedPath, cwd) {
  const identityPath = resolve(cwd, requestedPath);
  const localDirectory = resolve(cwd, localIdentityDirectory);
  const physicalRoot = realpathSync.native(cwd);
  let physicalIdentityPath;
  try {
    physicalIdentityPath = realpathSync.native(identityPath);
  } catch (error) {
    throw new Error("Unable to read the local Partner Center identity file.", {
      cause: error,
    });
  }
  const insideRepository =
    isWithin(cwd, identityPath) || isWithin(physicalRoot, physicalIdentityPath);
  if (
    insideRepository &&
    !(
      isWithin(localDirectory, identityPath) &&
      isWithin(physicalRoot, physicalIdentityPath) &&
      isWithin(realpathSync.native(localDirectory), physicalIdentityPath)
    )
  ) {
    throw new Error(
      `A Partner Center identity inside the repository must stay below ${localIdentityDirectory}, which is gitignored.`,
    );
  }
  if (!insideRepository && !isAbsolute(requestedPath)) {
    throw new Error(
      "A Partner Center identity outside the repository must use an explicit absolute path.",
    );
  }

  let bytes;
  try {
    bytes = readFileSync(identityPath);
  } catch (error) {
    throw new Error("Unable to read the local Partner Center identity file.", {
      cause: error,
    });
  }
  if (bytes.length < 2 || bytes.length > 64 * 1024) {
    throw new Error("The Partner Center identity file has an invalid size.");
  }
  let identity;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    identity = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(
      "The Partner Center identity file must be valid UTF-8 JSON.",
      {
        cause: error,
      },
    );
  }
  if (
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    Object.keys(identity).length !== identityFields.length ||
    !identityFields.every((field) => Object.hasOwn(identity, field))
  ) {
    throw new Error(
      "The Partner Center identity file must contain only the canonical identity fields.",
    );
  }
  const normalized = validatePartnerCenterIdentity(identity);
  for (const field of identityFields.filter(
    (field) => field !== "schemaVersion",
  )) {
    if (identity[field] !== normalized[field]) {
      throw new Error(
        `Partner Center identity field ${field} must already be canonical.`,
      );
    }
  }
  assertWindowsLegalPublisher(normalized.publisherDisplayName);
  if (
    rejectedIndividualPublisherAliases.has(
      normalized.publisherDisplayName.toLowerCase(),
    )
  ) {
    throw new Error(
      "The local Partner Center identity must use the exact verified personal publisher display name, not a project alias.",
    );
  }
  return normalized;
}

function isWithin(parent, child) {
  const pathWithinParent = relative(parent, child);
  return (
    pathWithinParent === "" ||
    (pathWithinParent !== ".." &&
      !pathWithinParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathWithinParent))
  );
}

function runChecker(spawnSyncFn, scriptPath, args, options, label) {
  const result = spawnSyncFn(process.execPath, [scriptPath, ...args], options);
  if (result?.error) {
    throw new Error(
      `Unable to run the ${label} checker: ${result.error.message}`,
    );
  }
  if (!Number.isInteger(result?.status)) {
    throw new Error(`The ${label} checker ended without an exit status.`);
  }
  return result.status;
}

function assertNotRepeated(seen, flag) {
  if (seen.has(flag)) {
    throw new Error(`${flag} must be supplied at most once.`);
  }
  seen.add(flag);
}

function main() {
  try {
    process.exitCode = runStorePolicyPreflight(process.argv.slice(2));
  } catch (error) {
    console.error(
      `Store policy preflight error: ${error instanceof Error ? error.message : "Unknown failure."}`,
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
