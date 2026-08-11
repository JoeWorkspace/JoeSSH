import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertExpectedSha256,
  assertMsixManifestLanguages,
  assertReviewedCommit,
  parseMsixManifestContract,
} from "./windows-store-contract.mjs";
import { assertUnredirectedStagingPath } from "./prepare-windows-store-msix-sandbox.mjs";
import { readWindowsStoreManifestLanguageContract } from "./windows-store-language-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const stagingParent = resolve(
  root,
  "reports/handoff/windows-store/msix-sandbox",
);
const provenanceFileName = "language-finalization.json";

export function finalizeWindowsStoreMsixLanguages(
  rawArgs = process.argv.slice(2),
  {
    platform = process.platform,
    spawn = spawnSync,
    log = console.log,
    resolveWindowsSdkTool = resolveWindowsSdkToolFromHost,
  } = {},
) {
  if (platform !== "win32") {
    throw new Error("MSIX language finalization requires Windows.");
  }
  const options = parseArgs(rawArgs);
  if (options.help) {
    printHelp(log);
    return null;
  }
  const reviewedSha = assertReviewedCommit(options.reviewedSha);
  assertCleanReviewedHead(reviewedSha, spawn);
  const languageContract = readWindowsStoreManifestLanguageContract();
  const stagingRoot = assertApprovedStagingRoot(options.stagingRoot);
  const plan = readJson(resolve(stagingRoot, "plan.json"), "Sandbox plan");
  assertPlanBinding(plan, reviewedSha, languageContract);

  const outputRoot = resolve(stagingRoot, "output");
  assertInside(stagingRoot, outputRoot, "Sandbox output");
  const result = readJson(resolve(outputRoot, "result.json"), "Sandbox result");
  assertCompletedSandboxResult(result, plan);
  const rawPackage = resolve(outputRoot, result.fileName);
  assertDirectFile(rawPackage, ".msix", "raw Sandbox MSIX");
  assertSnapshot(rawPackage, result, "raw Sandbox MSIX");

  const finalRoot = resolve(stagingRoot, "final");
  assertInside(stagingRoot, finalRoot, "finalized MSIX output");
  if (existsSync(finalRoot)) {
    throw new Error("Refusing to overwrite an existing finalized MSIX output.");
  }

  const makeAppx = resolveWindowsSdkTool("makeappx.exe");
  assertDirectFile(makeAppx, ".exe", "Windows SDK MakeAppx");
  const makeAppxSha256 = sha256File(makeAppx);
  const sdkVersion = basename(resolve(makeAppx, "../.."));
  const workRoot = mkdtempSync(
    join(tmpdir(), "joessh-msix-language-finalize-"),
  );
  const cleanupRoot = assertSafeTemporaryRoot(workRoot);
  let finalCreated = false;
  try {
    const rawUnpacked = resolve(workRoot, "raw-unpacked");
    const finalUnpacked = resolve(workRoot, "final-unpacked");
    const temporaryPackage = resolve(workRoot, plan.packageFileName);
    runMakeAppx(
      makeAppx,
      ["unpack", "/p", rawPackage, "/d", rawUnpacked, "/o", "/v"],
      "MakeAppx could not unpack the raw Sandbox MSIX.",
      spawn,
    );
    const manifestPath = resolve(rawUnpacked, "AppxManifest.xml");
    assertDirectFile(manifestPath, ".xml", "unpacked AppxManifest.xml");
    const originalManifest = readFileSync(manifestPath, "utf8");
    const rawContract = parseMsixManifestContract(originalManifest);
    if (
      rawContract.identity.version !== plan.msixVersion ||
      rawContract.identity.architecture !== plan.architecture
    ) {
      throw new Error(
        "Raw Sandbox MSIX identity does not match its reviewed Sandbox plan.",
      );
    }
    const finalizedManifest = replaceManifestLanguages(
      originalManifest,
      languageContract.manifestLanguages,
    );
    writeFileSync(manifestPath, finalizedManifest, {
      encoding: "utf8",
      flag: "w",
      mode: 0o600,
    });
    runMakeAppx(
      makeAppx,
      ["pack", "/d", rawUnpacked, "/p", temporaryPackage, "/o", "/v"],
      "MakeAppx could not repack the language-finalized MSIX.",
      spawn,
    );
    runMakeAppx(
      makeAppx,
      ["unpack", "/p", temporaryPackage, "/d", finalUnpacked, "/o", "/v"],
      "MakeAppx could not validate the language-finalized MSIX.",
      spawn,
    );
    const verifiedManifest = readFileSync(
      resolve(finalUnpacked, "AppxManifest.xml"),
      "utf8",
    );
    const finalContract = parseMsixManifestContract(verifiedManifest);
    assertMsixManifestLanguages(
      finalContract.languages,
      languageContract.manifestLanguages,
    );
    if (
      JSON.stringify(finalContract.identity) !==
        JSON.stringify(rawContract.identity) ||
      JSON.stringify(finalContract.desktopApplication) !==
        JSON.stringify(rawContract.desktopApplication)
    ) {
      throw new Error(
        "Language finalization changed the reviewed MSIX identity or desktop application contract.",
      );
    }
    assertPayloadTreesMatch(rawUnpacked, finalUnpacked);

    mkdirSync(finalRoot, { mode: 0o700 });
    finalCreated = true;
    const finalPackage = resolve(finalRoot, plan.packageFileName);
    copyFileSync(temporaryPackage, finalPackage, 1);
    const finalArtifact = snapshot(finalPackage);
    const provenance = {
      schemaVersion: 1,
      state: "completed",
      reviewedSha,
      projectVersion: plan.projectVersion,
      msixVersion: plan.msixVersion,
      rawArtifact: snapshot(rawPackage),
      finalArtifact,
      manifestLanguageContract: languageContract,
      transformation: {
        method: "MakeAppx-unpack-edit-manifest-repack",
        generatedPackageMetadataRegenerated: ["AppxBlockMap.xml"],
        payloadFilesByteIdentical: true,
        semanticContentChange: "AppxManifest.Resources-only",
      },
      makeAppx: {
        fileName: basename(makeAppx),
        sdkVersion,
        sha256: makeAppxSha256,
      },
    };
    writeFileSync(
      resolve(finalRoot, provenanceFileName),
      `${JSON.stringify(provenance, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    log(
      `Finalized ${plan.packageFileName} with ${languageContract.manifestLanguages.length} reviewed UI languages.`,
    );
    return { finalPackage, finalRoot, provenance };
  } catch (error) {
    if (finalCreated) {
      assertInside(stagingRoot, finalRoot, "failed finalized MSIX output");
      rmSync(finalRoot, { force: true, recursive: true });
    }
    throw error;
  } finally {
    rmSync(cleanupRoot, { force: true, recursive: true });
  }
}

function assertSafeTemporaryRoot(value) {
  const canonicalTemporaryRoot = realpathSync(value);
  const canonicalSystemTemporaryRoot = realpathSync(tmpdir());
  assertInside(
    canonicalSystemTemporaryRoot,
    canonicalTemporaryRoot,
    "MSIX finalization temporary root",
  );
  if (
    !basename(canonicalTemporaryRoot).startsWith(
      "joessh-msix-language-finalize-",
    )
  ) {
    throw new Error("Refusing unsafe MSIX finalization temporary cleanup.");
  }
  return canonicalTemporaryRoot;
}

export function replaceManifestLanguages(xml, expectedLanguages) {
  const contract = parseMsixManifestContract(xml);
  const canonicalLanguages = assertMsixManifestLanguages(
    expectedLanguages,
    expectedLanguages,
  );
  if (contract.languages.length === 0) {
    throw new Error("Raw MSIX manifest has no language declaration.");
  }
  const matches = [...xml.matchAll(/<Resources>[\s\S]*?<\/Resources>/g)];
  if (matches.length !== 1) {
    throw new Error(
      "Raw MSIX manifest must contain one unprefixed Resources element from the approved Packaging Tool profile.",
    );
  }
  const indentation = "  ";
  const replacement = [
    "<Resources>",
    ...canonicalLanguages.map(
      (language) =>
        `${indentation}${indentation}<Resource Language="${language}" />`,
    ),
    `${indentation}</Resources>`,
  ].join("\r\n");
  const updated = `${xml.slice(0, matches[0].index)}${replacement}${xml.slice(
    matches[0].index + matches[0][0].length,
  )}`;
  assertMsixManifestLanguages(
    parseMsixManifestContract(updated).languages,
    canonicalLanguages,
  );
  return updated;
}

export function parseArgs(args) {
  const options = { help: false, reviewedSha: "", stagingRoot: "" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [rawFlag, inlineValue] = argument.split("=", 2);
    if (!["--reviewed-sha", "--staging-root"].includes(rawFlag)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${rawFlag} requires a value.`);
    }
    if (rawFlag === "--reviewed-sha") options.reviewedSha = value;
    if (rawFlag === "--staging-root") options.stagingRoot = resolve(value);
  }
  if (!options.help) {
    if (!options.reviewedSha) throw new Error("--reviewed-sha is required.");
    if (!options.stagingRoot) throw new Error("--staging-root is required.");
  }
  return options;
}

function assertPlanBinding(plan, reviewedSha, languageContract) {
  if (
    plan?.schemaVersion !== 1 ||
    plan.state !== "prepared" ||
    plan.reviewedSha !== reviewedSha ||
    plan.artifactSourceSha !== reviewedSha ||
    typeof plan.projectVersion !== "string" ||
    typeof plan.msixVersion !== "string" ||
    typeof plan.packageFileName !== "string" ||
    !plan.packageFileName.toLowerCase().endsWith(".msix") ||
    JSON.stringify(plan.manifestLanguageContract) !==
      JSON.stringify(languageContract)
  ) {
    throw new Error(
      "Sandbox plan does not bind the exact reviewed HEAD and manifest language contract.",
    );
  }
}

function assertCompletedSandboxResult(result, plan) {
  if (
    result?.schemaVersion !== 1 ||
    result.state !== "completed" ||
    result.fileName !== plan.packageFileName ||
    result.authenticode !== "NotSigned" ||
    result.toolVersion !== plan.toolingVersion ||
    !Number.isSafeInteger(result.sizeBytes) ||
    result.sizeBytes <= 0 ||
    result.sha256 !== assertExpectedSha256(result.sha256)
  ) {
    throw new Error(
      "Sandbox result is not a completed unsigned reviewed MSIX.",
    );
  }
}

function assertPayloadTreesMatch(rawRoot, finalRoot) {
  const rawFiles = inspectPayloadTree(rawRoot);
  const finalFiles = inspectPayloadTree(finalRoot);
  if (JSON.stringify(rawFiles) !== JSON.stringify(finalFiles)) {
    const rawByPath = new Map(rawFiles.map((file) => [file.path, file.sha256]));
    const finalByPath = new Map(
      finalFiles.map((file) => [file.path, file.sha256]),
    );
    const differences = [
      ...new Set([...rawByPath.keys(), ...finalByPath.keys()]),
    ]
      .filter((path) => rawByPath.get(path) !== finalByPath.get(path))
      .sort()
      .slice(0, 8);
    throw new Error(
      `Language finalization changed a payload file outside AppxManifest.xml: ${differences.join(", ")}.`,
    );
  }
}

function inspectPayloadTree(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      const relativePath = relative(directory, path).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        throw new Error("Unpacked MSIX must not contain symbolic links.");
      }
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          "Unpacked MSIX contains an unsupported filesystem entry.",
        );
      }
      if (
        ["appxmanifest.xml", "appxblockmap.xml"].includes(
          relativePath.toLowerCase(),
        )
      ) {
        continue;
      }
      files.push({ path: relativePath, sha256: sha256File(path) });
    }
  };
  walk(directory);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function assertApprovedStagingRoot(value) {
  const resolved = resolve(value);
  assertInside(stagingParent, resolved, "Sandbox staging root");
  assertUnredirectedStagingPath(root, resolved);
  const canonical = realpathSync(resolved);
  assertInside(realpathSync(stagingParent), canonical, "Sandbox staging root");
  return canonical;
}

function resolveWindowsSdkToolFromHost(fileName) {
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const sdkRoot = resolve(programFilesX86, "Windows Kits/10/bin");
  const candidates = [];
  for (const version of readdirSync(sdkRoot, { withFileTypes: true })) {
    if (!version.isDirectory() || !/^\d+(?:\.\d+){3}$/.test(version.name)) {
      continue;
    }
    const path = resolve(sdkRoot, version.name, "x64", fileName);
    if (existsSync(path)) candidates.push(path);
  }
  candidates.sort((left, right) =>
    right.localeCompare(left, undefined, { numeric: true }),
  );
  if (candidates.length === 0) {
    throw new Error(`${fileName} was not found in the Windows SDK.`);
  }
  const selected = realpathSync(candidates[0]);
  assertInside(realpathSync(sdkRoot), selected, fileName);
  return selected;
}

function runMakeAppx(executable, args, message, spawn) {
  const result = spawn(executable, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(message, { cause: result.error });
  }
}

function assertCleanReviewedHead(reviewedSha, spawn) {
  const head = runGit(["rev-parse", "HEAD"], spawn).trim().toLowerCase();
  if (head !== reviewedSha) {
    throw new Error("--reviewed-sha must exactly equal the current Git HEAD.");
  }
  if (
    runGit(["status", "--porcelain", "--untracked-files=all"], spawn).trim()
  ) {
    throw new Error(
      "MSIX language finalization requires a clean reviewed worktree.",
    );
  }
}

function runGit(args, spawn) {
  const result = spawn("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Git ${args[0]} failed during MSIX language finalization.`);
  }
  return result.stdout;
}

function assertDirectFile(path, extension, label) {
  if (!existsSync(path) || !path.toLowerCase().endsWith(extension)) {
    throw new Error(`${label} is missing or has the wrong extension.`);
  }
  const metadata = lstatSync(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()
  ) {
    throw new Error(`${label} must be a direct regular file.`);
  }
}

function assertSnapshot(path, evidence, label) {
  const metadata = statSync(path);
  if (
    metadata.size !== evidence.sizeBytes ||
    sha256File(path) !== evidence.sha256
  ) {
    throw new Error(`${label} does not match its Sandbox result evidence.`);
  }
}

function snapshot(path) {
  const metadata = statSync(path);
  return {
    fileName: basename(path),
    sha256: sha256File(path),
    sizeBytes: metadata.size,
  };
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`${label} must be valid UTF-8 JSON.`);
  }
}

function assertInside(parent, child, label) {
  const relativePath = relative(parent, child);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay below its approved parent directory.`);
  }
}

function printHelp(log) {
  log(`Finalize a completed raw JoeSSH Sandbox MSIX with the exact reviewed UI
language list. The raw package remains unchanged; a new package and provenance
are written below the Sandbox staging root's final directory.

Required:
  --reviewed-sha <full clean HEAD>
  --staging-root <reports/handoff/windows-store/msix-sandbox/...>`);
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (invokedPath && resolve(process.argv[1]) === resolve(invokedPath)) {
  try {
    finalizeWindowsStoreMsixLanguages();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
