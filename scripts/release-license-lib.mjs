import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { referencedCargoLicenseSources, reviewedCargoLicenseSources } from "./release-license-source-overrides.mjs";
import { assertReportOutput, cargoLockInventory, lockfileBinding, npmComponentName, npmWorkspaceInventory, sbomFileNames, sha256File } from "./release-sbom-lib.mjs";

export const licenseInventoryName = "third-party-licenses.json";
export const licenseTextsName = "third-party-license-texts.json";
const standardLicenses = new Set("0BSD Apache-2.0 BSD-1-Clause BSD-2-Clause BSD-3-Clause BSL-1.0 BlueOak-1.0.0 CC-BY-4.0 CC0-1.0 GPL-2.0 GPL-2.0-only GPL-2.0-or-later ISC LGPL-2.1-or-later MIT MIT-0 MPL-2.0 Python-2.0 Unicode-3.0 Unicode-DFS-2016 Unlicense Zlib".split(" "));
const textName = /^(?:licen[cs]e|copying|copyright|notice|unlicense)(?:[._-].*)?$/i;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// This is a conservative supported SPDX vocabulary, not a legal approval.
// Unrecognized/custom expressions require review instead of silently passing.
export function validateLicenseExpression(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("missing license declaration");
  const expression = value.replace(/\s*\/\s*/g, " OR "); // historical Cargo syntax
  const tokens = expression.match(/[A-Za-z0-9.+-]+|[()]/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) throw new Error(`unsupported license declaration: ${value}`);
  let index = 0;
  function term() {
    if (tokens[index] === "(") { index++; sequence(); if (tokens[index++] !== ")") throw new Error("invalid license expression"); }
    else {
      if (!standardLicenses.has(tokens[index++])) throw new Error(`unreviewed license declaration: ${value}`);
      if (tokens[index] === "WITH") { index++; if (tokens[index++] !== "LLVM-exception") throw new Error(`unreviewed license exception: ${value}`); }
    }
  }
  function sequence() { term(); while (["AND", "OR"].includes(tokens[index])) { index++; term(); } }
  sequence();
  if (index !== tokens.length) throw new Error(`invalid license expression: ${value}`);
  return value;
}

export function licenseComponents(documents, root) {
  const result = new Map();
  const internalNpm = new Set(["desktop", "web"].flatMap((workspace) => npmWorkspaceInventory(root, workspace))
    .filter((entry) => !entry.location.includes("node_modules/") && !entry.resolved)
    .map((entry) => `${entry.name}@${entry.version}`));
  for (const [filename, document] of Object.entries(documents)) {
    const npm = filename.startsWith("npm-");
    for (const component of npm ? document.components : document.packages) {
      const name = npm ? npmComponentName(component) : component.name;
      // Only path-based workspace components are first party. A registry package
      // with a familiar name still requires its own license material.
      const internal = npm ? internalNpm.has(`${name}@${component.version}`) : !component.source && ["atlasterm-core", "atlasterm-sync", "atlasterm-desktop-shell"].includes(name);
      if (internal) continue;
      const key = `${npm ? "npm" : "cargo"}:${name}@${component.version}`;
      const license = npm ? (component.licenses ?? []).map((entry) => entry.expression ?? entry.license?.id ?? entry.license?.name).filter(Boolean).join(" AND ") : component.license;
      const previous = result.get(key);
      if (previous && previous.license !== license) throw new Error(`inconsistent license declaration for ${key}`);
      result.set(key, { id: key, ecosystem: npm ? "npm" : "cargo", name, version: component.version, license, ...(component.manifest_path ? { manifestPath: component.manifest_path } : {}) });
    }
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Public registry tarballs are fetched by lock URL, verified against lock SRI,
// and read in memory. Nothing is extracted or executed.
export async function npmArchiveTexts(entry, fetchArchive = fetch, archiveCachePath) {
  const url = new URL(entry.resolved);
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" || url.username || url.password || url.search || url.hash) throw new Error("unsupported npm source; review required");
  const match = entry.integrity?.match(/^(sha512|sha256|sha1)-([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("npm source lacks supported lock integrity");
  const digest = Buffer.from(match[2], "base64").toString("hex");
  const cached = archiveCachePath ? resolve(archiveCachePath, "_cacache", "content-v2", match[1], digest.slice(0, 2), digest.slice(2, 4), digest.slice(4)) : undefined;
  let compressed;
  if (cached && existsSync(cached)) {
    if (lstatSync(cached).size > 100 * 1024 * 1024) throw new Error("npm archive exceeds size limit");
    compressed = readFileSync(cached);
  } else {
    const response = await fetchArchive(url, { redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`npm source request failed: HTTP ${response.status}`);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 100 * 1024 * 1024) throw new Error("npm archive exceeds size limit");
      chunks.push(chunk);
    }
    compressed = Buffer.concat(chunks);
  }
  if (createHash(match[1]).update(compressed).digest("base64") !== match[2]) throw new Error("npm archive integrity mismatch");
  const { files, manifestText } = readLicenseArchive(compressed, "package.json");
  const manifest = manifestText ? JSON.parse(manifestText) : undefined;
  if (!manifest || manifest.name !== entry.name || manifest.version !== entry.version) throw new Error("npm archive package identity mismatch");
  return { files, manifest };
}

export function readLicenseArchive(compressed, manifestName, requiredPrefix) {
  const tar = gunzipSync(compressed, { maxOutputLength: 300 * 1024 * 1024 });
  const files = new Map();
  let manifestText;
  let vcsInfo;
  let rootLibRs;
  let archivePrefix;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const string = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const sizeText = string(124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("unsupported tar entry size");
    const size = parseInt(sizeText, 8);
    const name = [string(345, 155), string(0, 100)].filter(Boolean).join("/");
    const type = string(156, 1);
    const end = offset + 512 + size;
    if (end > tar.length) throw new Error("truncated source archive");
    if (type === "0" || type === "") {
      const parts = name.split("/");
      const prefix = parts.shift();
      archivePrefix ??= prefix;
      if (prefix !== archivePrefix || (requiredPrefix && prefix !== requiredPrefix) || parts.includes("..") || name.startsWith("/")) throw new Error("unsafe source archive path");
      const path = parts.join("/");
      const content = tar.subarray(offset + 512, end);
      if (path === manifestName) manifestText = content.toString("utf8");
      if (path === ".cargo_vcs_info.json") vcsInfo = JSON.parse(content.toString("utf8"));
      if (path === "lib.rs" && content.length <= 2 * 1024 * 1024) rootLibRs = content;
      const authorsLicense = /^AUTHORS(?:\.[^/]*)?$/i.test(basename(path)) && content.includes("Permission is hereby granted, free of charge") && content.includes("THE SOFTWARE IS PROVIDED");
      if (textName.test(basename(path)) || authorsLicense) {
        if (!content.length || content.length > 2 * 1024 * 1024 || content.includes(0)) throw new Error("invalid archived license text");
        new TextDecoder("utf-8", { fatal: true }).decode(content);
        if (files.has(path)) throw new Error("duplicate archived license text");
        files.set(path, content);
      }
    }
    offset = offset + 512 + Math.ceil(size / 512) * 512;
  }
  return { files, manifestText, vcsInfo, rootLibRs };
}

export function cargoArchiveTexts(component, locked) {
  if (locked?.source !== "registry+https://github.com/rust-lang/crates.io-index") throw new Error("unsupported Cargo registry source; review required");
  const sourceRoot = dirname(component.manifestPath);
  const archive = resolve(dirname(dirname(dirname(sourceRoot))), "cache", basename(dirname(sourceRoot)), component.name + "-" + component.version + ".crate");
  if (!locked?.checksum || !existsSync(archive)) throw new Error("Cargo archive cache missing or not checksum-locked; run cargo fetch --locked");
  if (lstatSync(archive).size > 100 * 1024 * 1024) throw new Error("Cargo archive exceeds size limit");
  const compressed = readFileSync(archive);
  if (hash(compressed) !== locked.checksum) throw new Error("Cargo archive checksum does not match lockfile");
  const source = readLicenseArchive(compressed, "Cargo.toml", component.name + "-" + component.version);
  const packageBlock = source.manifestText?.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const field = (name) => packageBlock?.match(new RegExp('^' + name + ' = "([^"\\r\\n]+)"$', 'm'))?.[1];
  if (field("name") !== component.name || field("version") !== component.version) throw new Error("Cargo archive package identity mismatch");
  const result = { files: source.files, license: field("license"), repository: field("repository"), vcsInfo: source.vcsInfo, archiveSha256: locked.checksum };
  const reviewed = reviewedCargoLicenseSources.find((entry) => entry.component === `cargo:${component.name}@${component.version}` && entry.archiveSha256 === locked.checksum);
  if (reviewed) {
    if (source.vcsInfo?.git?.sha1 && source.vcsInfo.git.sha1 !== reviewed.commit) throw new Error("reviewed source disagrees with archive VCS identity");
    result.repository = reviewed.repository;
    result.vcsInfo = { git: { sha1: reviewed.commit }, path_in_vcs: reviewed.pathInVcs };
    result.reviewedAssociation = reviewed.associationKind;
  }
  const reference = referencedCargoLicenseSources.find((entry) => entry.component === `cargo:${component.name}@${component.version}` && entry.archiveSha256 === locked.checksum);
  if (reference) {
    if (!source.rootLibRs || hash(source.rootLibRs) !== reference.noticeFileSha256) throw new Error("original license reference source does not match reviewed archive");
    const notice = Buffer.from(source.rootLibRs.toString("utf8").split("\n").slice(0, 3).join("\n") + "\n");
    if (!notice.includes("https://mozilla.org/MPL/2.0/")) throw new Error("source does not contain the original MPL license reference");
    const licenseText = readFileSync(resolve(import.meta.dirname, "release-license-texts", reference.licenseTextFile));
    if (hash(licenseText) !== reference.licenseTextSha256) throw new Error("referenced official license text checksum mismatch");
    result.files.set(`${reference.noticeFile}.license-notice`, notice);
    result.files.set(reference.licenseTextFile, licenseText);
    result.officialReference = { kind: "official-license-reference", archiveSha256: locked.checksum, noticeFileSha256: reference.noticeFileSha256, url: reference.licenseTextUrl, sha256: reference.licenseTextSha256 };
  }
  return result;
}

export async function githubCommitLicenseTexts(source, fetchSource = fetch, cache = new Map()) {
  const repository = source.repository?.replace(/^git\+/, "").replace(/\.git$/, "");
  const match = repository?.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/tree\/[A-Za-z0-9_./-]+)?\/?$/);
  const commit = source.vcsInfo?.git?.sha1;
  const packagePath = source.vcsInfo?.path_in_vcs ?? "";
  if (!match || !/^[a-f0-9]{40}$/.test(commit) || typeof packagePath !== "string" || packagePath.split(/[\\/]/).includes("..") || isAbsolute(packagePath)) throw new Error("missing reviewed immutable upstream license source");
  const project = `${match[1]}/${match[2]}`;
  const treeUrl = `https://api.github.com/repos/${project}/git/trees/${commit}?recursive=1`;
  const tree = JSON.parse((await fetchBounded(treeUrl, 20 * 1024 * 1024)).toString("utf8"));
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("upstream license tree is incomplete");
  const ancestors = new Set([""]);
  const parts = packagePath.split("/").filter(Boolean);
  for (let index = 1; index <= parts.length; index++) ancestors.add(parts.slice(0, index).join("/"));
  const candidates = tree.tree.filter((entry) => {
    if (entry.type !== "blob" || typeof entry.path !== "string" || !(entry.size > 0 && entry.size <= 2 * 1024 * 1024) || entry.path.split("/").includes("..")) return false;
    const directory = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
    if (textName.test(basename(entry.path)) && ancestors.has(directory)) return true;
    return [...ancestors].some((ancestor) => new RegExp(`^${ancestor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${ancestor ? "/" : ""}LICENSES?/[^/]+\\.(?:txt|md)$`, "i").test(entry.path));
  });
  if (!candidates.length || candidates.length > 50) throw new Error("no bounded upstream license text at package ancestors");
  const files = new Map();
  for (const candidate of candidates) {
    const url = `https://raw.githubusercontent.com/${project}/${commit}/${candidate.path.split("/").map(encodeURIComponent).join("/")}`;
    let content;
    try { content = await fetchBounded(url, 2 * 1024 * 1024); }
    catch {
      if (!/^[a-f0-9]{40}$/.test(candidate.sha)) throw new Error("invalid committed license blob identity");
      const blob = JSON.parse((await fetchBounded(`https://api.github.com/repos/${project}/git/blobs/${candidate.sha}`, 3 * 1024 * 1024)).toString("utf8"));
      if (blob.encoding !== "base64" || typeof blob.content !== "string" || !/^[A-Za-z0-9+/=\s]+$/.test(blob.content)) throw new Error("invalid upstream license blob response");
      content = Buffer.from(blob.content, "base64");
    }
    if (!content.length || content.length > 2 * 1024 * 1024 || content.includes(0)) throw new Error("invalid upstream license text");
    new TextDecoder("utf-8", { fatal: true }).decode(content);
    const gitHash = createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
    if (gitHash !== candidate.sha) throw new Error("upstream license blob does not match committed tree");
    files.set(candidate.path, content);
  }
  return { files, licenseSource: { kind: "upstream-commit", repository: `https://github.com/${project}`, commit, packagePath, archiveSha256: source.archiveSha256, ...(source.reviewedAssociation ? { reviewedAssociation: source.reviewedAssociation } : {}) } };
  async function fetchBounded(url, limit) {
    if (!cache.has(url)) cache.set(url, (async () => {
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { response = await fetchSource(url, { redirect: "error", signal: AbortSignal.timeout(30000) }); break; }
        catch (error) { if (attempt === 2) throw error; }
      }
      if ([403, 429].includes(response.status) && fetchSource === fetch && url.startsWith("https://api.github.com/")) {
        // Optional authenticated, read-only API fallback. gh owns authentication;
        // credentials never enter arguments, output, or published material.
        const result = spawnSync("gh", ["api", "--method", "GET", url], { encoding: "utf8", timeout: 60000, maxBuffer: limit, stdio: ["ignore", "pipe", "pipe"] });
        if (result.status === 0) return Buffer.from(result.stdout);
      }
      if (!response.ok) throw new Error(`upstream license request failed: HTTP ${response.status}`);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > limit) throw new Error("upstream license response exceeds size limit");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    })());
    return cache.get(url);
  }
}

export async function collectLicenseMaterials(root, documents, { fetchArchive = fetch, archiveCachePath, onProgress = () => {} } = {}) {
  const npmPackages = [...npmWorkspaceInventory(root, "desktop"), ...npmWorkspaceInventory(root, "web")];
  const components = licenseComponents(documents, root);
  const cargoPackages = ["Cargo.lock", "apps/desktop/src-tauri/Cargo.lock"].flatMap((file) => cargoLockInventory(root, file));
  const entries = [];
  const texts = new Map();
  const errors = [];
  const sourcePromises = new Map();
  const upstreamPromises = new Map();
  const upstreamCache = new Map();
  const npmSource = (entry) => {
    const id = `${entry.name}@${entry.version}`;
    if (!sourcePromises.has(id)) sourcePromises.set(id, npmArchiveTexts(entry, fetchArchive, archiveCachePath));
    return sourcePromises.get(id);
  };
  async function collect(component) {
    try {
      let files;
      let declaration = component.license;
      let licenseSource;
      if (component.ecosystem === "npm") {
        const locked = npmPackages.find((entry) => entry.name === component.name && entry.version === component.version);
        if (!locked) throw new Error("component is not locked");
        // Registry archive integrity proves the source even if node_modules was edited locally.
        if (locked.resolved) {
          const source = await npmSource(locked);
          files = source.files;
          if (declaration && source.manifest.license !== declaration) throw new Error("npm archive license declaration disagrees with SBOM");
          if (locked.license && source.manifest.license !== locked.license) throw new Error("npm archive license declaration disagrees with lockfile");
          declaration ||= source.manifest.license;
          if (!files.size) {
            const parentName = platformLicenseParent(component.name);
            const parent = npmPackages.find((entry) => entry.name === parentName && entry.version === component.version);
            if (parent && parent.optionalDependencies?.[component.name] === component.version) {
              const parentSource = await npmSource(parent);
              const repository = (manifest) => (typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url)?.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "");
              if (!repository(source.manifest) || repository(source.manifest) !== repository(parentSource.manifest) || parentSource.manifest.license !== declaration) throw new Error("platform package license parent does not match verified source");
              files = parentSource.files;
              licenseSource = { kind: "parent-distribution", package: `npm:${parent.name}@${parent.version}`, integrity: parent.integrity };
            }
          }
        } else {
          throw new Error("third-party npm package lacks a pinned registry archive");
        }
      } else {
        const manifest = component.manifestPath;
        if (!manifest || !existsSync(manifest)) throw new Error("Cargo source cache missing; run cargo metadata --locked");
        const pkg = Object.values(documents).flatMap((doc) => doc.packages ?? []).find((entry) => entry.name === component.name && entry.version === component.version);
        const locked = cargoPackages.find((entry) => entry.name === component.name && entry.version === component.version && entry.source === pkg.source);
        const source = cargoArchiveTexts(component, locked);
        files = source.files;
        licenseSource = source.officialReference;
        if (source.license !== declaration) throw new Error("Cargo archive license declaration disagrees with metadata");
        if (!files.size) {
          const key = `${source.repository}:${source.vcsInfo?.git?.sha1}:${source.vcsInfo?.path_in_vcs}`;
          if (!upstreamPromises.has(key)) upstreamPromises.set(key, githubCommitLicenseTexts(source, fetchArchive, upstreamCache));
          const upstream = await upstreamPromises.get(key);
          files = upstream.files;
          licenseSource = { ...upstream.licenseSource, archiveSha256: source.archiveSha256 };
        }
      }
      validateLicenseExpression(declaration);
      if (!files.size) throw new Error("no packaged LICENSE/COPYING/NOTICE text found; review source distribution");
      const material = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([source, content]) => {
        const sha256 = hash(content);
        texts.set(sha256, content);
        return { source, sha256 };
      });
      entries.push({ id: component.id, ecosystem: component.ecosystem, name: component.name, version: component.version, license: declaration, ...(licenseSource ? { licenseSource } : {}), texts: material });
    } catch (error) { errors.push({ component: component.id, reason: error.message }); }
    onProgress(entries.length + errors.length, components.length);
  }
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < components.length) await collect(components[next++]);
  }));
  entries.sort((a, b) => a.id.localeCompare(b.id));
  errors.sort((a, b) => a.component.localeCompare(b.component));
  return { inventory: { schemaVersion: 1, lockfiles: lockfileBinding(root), components: entries }, texts, errors };
}

function platformLicenseParent(name) {
  if (name.startsWith("@esbuild/")) return "esbuild";
  if (name.startsWith("@rollup/rollup-")) return "rollup";
  if (name.startsWith("@tauri-apps/cli-")) return "@tauri-apps/cli";
  return undefined;
}

export function validateOfficialLicenseReference(component, lockedChecksum, texts) {
  const source = component.licenseSource;
  const reference = referencedCargoLicenseSources.find((entry) => entry.component === component.id && entry.archiveSha256 === source.archiveSha256);
  if (!reference || source.archiveSha256 !== lockedChecksum || source.noticeFileSha256 !== reference.noticeFileSha256 || source.url !== reference.licenseTextUrl || source.sha256 !== reference.licenseTextSha256 || !component.texts.some((text) => text.source === reference.licenseTextFile && text.sha256 === reference.licenseTextSha256) || !component.texts.some((text) => text.source === `${reference.noticeFile}.license-notice` && text.sha256 === reference.noticeSha256 && typeof texts[text.sha256] === "string" && hash(texts[text.sha256]) === reference.noticeSha256)) throw new Error("invalid original license reference");
}

export function validateRequiredLicenseSource(component, lockedChecksum) {
  const reviewed = reviewedCargoLicenseSources.find((entry) => entry.component === component.id && entry.archiveSha256 === lockedChecksum);
  const reference = referencedCargoLicenseSources.find((entry) => entry.component === component.id && entry.archiveSha256 === lockedChecksum);
  if ((reviewed && component.licenseSource?.kind !== "upstream-commit") || (reference && component.licenseSource?.kind !== "official-license-reference")) throw new Error("required original license source is missing");
}

export function validateReviewedCargoAssociation(component) {
  const source = component.licenseSource;
  const reviewed = reviewedCargoLicenseSources.find((entry) => entry.component === component.id && entry.archiveSha256 === source.archiveSha256);
  if (reviewed || source.reviewedAssociation) {
    if (!reviewed || reviewed.repository !== source.repository || reviewed.commit !== source.commit || reviewed.pathInVcs !== source.packagePath || reviewed.associationKind !== source.reviewedAssociation || component.texts.length !== reviewed.materials.length || reviewed.materials.some((entry) => !component.texts.some((text) => entry.path === text.source && entry.sha256 === text.sha256))) throw new Error("invalid reviewed upstream license association");
  }
}

export function validateLicenseInventory(root, outputDir, documents) {
  const file = assertReportOutput(root, resolve(outputDir, licenseInventoryName));
  const inventory = JSON.parse(readFileSync(file, "utf8"));
  const texts = JSON.parse(readFileSync(assertReportOutput(root, resolve(outputDir, licenseTextsName)), "utf8"));
  if (!texts || typeof texts !== "object" || Array.isArray(texts)) throw new Error("invalid license text bundle");
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.components)) throw new Error("invalid third-party license inventory");
  const expectedBinding = lockfileBinding(root);
  if (!inventory.lockfiles || Object.keys(inventory.lockfiles).length !== 3 || Object.entries(expectedBinding).some(([name, value]) => inventory.lockfiles[name] !== value)) throw new Error("license inventory lockfile binding mismatch");
  if (!inventory.sboms || Object.keys(inventory.sboms).length !== 4 || sbomFileNames.some((name) => inventory.sboms[name] !== sha256File(resolve(outputDir, name)))) throw new Error("license inventory SBOM binding mismatch");
  const expected = new Map(licenseComponents(documents, root).map((entry) => [entry.id, entry]));
  const covered = new Set();
  const coveredTexts = new Set();
  const npmPackages = [...npmWorkspaceInventory(root, "desktop"), ...npmWorkspaceInventory(root, "web")];
  const cargoPackages = ["Cargo.lock", "apps/desktop/src-tauri/Cargo.lock"].flatMap((file) => cargoLockInventory(root, file));
  for (const component of inventory.components) {
    const original = expected.get(component.id);
    if (!original || covered.has(component.id) || ["name", "version", "ecosystem"].some((key) => component[key] !== original[key])) throw new Error("unexpected or duplicate license component");
    covered.add(component.id);
    validateLicenseExpression(component.license);
    if (original.license && original.license !== component.license) throw new Error(`license declaration mismatch for ${component.id}`);
    const lockedCargo = cargoPackages.find((entry) => entry.name === component.name && entry.version === component.version);
    validateRequiredLicenseSource(component, lockedCargo?.checksum);
    if (component.licenseSource?.kind === "official-license-reference") {
      const locked = ["Cargo.lock", "apps/desktop/src-tauri/Cargo.lock"].flatMap((file) => cargoLockInventory(root, file)).find((entry) => entry.name === component.name && entry.version === component.version);
      validateOfficialLicenseReference(component, locked?.checksum, texts);
    } else if (component.licenseSource?.kind === "upstream-commit") {
      const source = component.licenseSource;
      const locked = ["Cargo.lock", "apps/desktop/src-tauri/Cargo.lock"].flatMap((file) => cargoLockInventory(root, file)).find((entry) => entry.name === component.name && entry.version === component.version);
      if (component.ecosystem !== "cargo" || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository) || !/^[a-f0-9]{40}$/.test(source.commit) || source.archiveSha256 !== locked?.checksum || typeof source.packagePath !== "string" || isAbsolute(source.packagePath) || source.packagePath.split(/[\\/]/).includes("..")) throw new Error("invalid immutable upstream license source");
      validateReviewedCargoAssociation(component);
    } else if (component.licenseSource) {
      const parentName = platformLicenseParent(component.name);
      const parent = npmPackages.find((entry) => entry.name === parentName && entry.version === component.version);
      const parentId = `npm:${parentName}@${component.version}`;
      const parentMaterial = inventory.components.find((entry) => entry.id === parentId);
      if (component.licenseSource.kind !== "parent-distribution" || component.ecosystem !== "npm" || !parent || parent.optionalDependencies?.[component.name] !== component.version || component.licenseSource.package !== parentId || component.licenseSource.integrity !== parent.integrity || !parentMaterial || parentMaterial.license !== component.license || component.texts.some((text) => !parentMaterial.texts.some((entry) => entry.sha256 === text.sha256 && entry.source === text.source))) throw new Error("invalid platform package license source");
    }
    if (!Array.isArray(component.texts) || !component.texts.length) throw new Error(`missing license texts for ${component.id}`);
    for (const text of component.texts) {
      if (!/^[a-f0-9]{64}$/.test(text.sha256) || Object.hasOwn(text, "path") || typeof text.source !== "string" || !text.source || isAbsolute(text.source) || /^[a-z]:/i.test(text.source) || text.source.split(/[\\/]/).includes("..")) throw new Error("invalid license material path");
      const content = texts[text.sha256];
      if (typeof content !== "string" || !content.length || hash(content) !== text.sha256) throw new Error("license text hash mismatch");
      coveredTexts.add(text.sha256);
    }
  }
  if ([...expected.keys()].some((key) => !covered.has(key))) throw new Error("third-party license inventory is incomplete");
  if (Object.keys(texts).some((key) => !coveredTexts.has(key))) throw new Error("license text bundle contains unreferenced material");
  return [licenseInventoryName, licenseTextsName];
}
