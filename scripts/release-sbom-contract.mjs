import { basename, resolve } from "node:path";

export function canonicalizeNpmCycloneDx(
  input,
  { label = "npm CycloneDX SBOM", packageName, rootPath },
) {
  const json = parseStrictJson(input, label);
  assertCycloneDxObject(json, label);
  assertPackageName(packageName);

  delete json.serialNumber;
  delete json.metadata.timestamp;
  json.metadata.component.name = packageName;

  const leaks = findLocalPathLeaks(json, { packageName, rootPath });
  if (leaks.length > 0) {
    throw new Error(
      `${label} contains local path or worktree data:\n- ${leaks.join("\n- ")}`,
    );
  }

  return stableJson(json);
}

export function inspectCanonicalNpmCycloneDx(
  input,
  { label = "npm CycloneDX SBOM", packageName, rootPath },
) {
  const errors = [];
  let json;
  let text;
  try {
    text = decodeStrictUtf8(input, label);
    json = JSON.parse(text);
  } catch (error) {
    return [
      error instanceof Error
        ? error.message
        : `${label} is not valid UTF-8 JSON`,
    ];
  }

  try {
    assertCycloneDxObject(json, label);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return errors;
  }

  if (Object.hasOwn(json, "serialNumber")) {
    errors.push(`${label} must not contain a nondeterministic serialNumber`);
  }
  if (Object.hasOwn(json.metadata, "timestamp")) {
    errors.push(
      `${label} must not contain a nondeterministic metadata.timestamp`,
    );
  }
  if (json.metadata.component.name !== packageName) {
    errors.push(
      `${label} metadata.component.name must equal root package name ${packageName}`,
    );
  }
  errors.push(
    ...findLocalPathLeaks(json, { packageName, rootPath }).map(
      (leak) => `${label} contains local path or worktree data: ${leak}`,
    ),
  );
  if (stableJson(json) !== text) {
    errors.push(`${label} must use stable sorted JSON with UTF-8 LF output`);
  }
  return errors;
}

export function buildCargoCycloneDx(
  metadataInput,
  lockInput,
  {
    boundary,
    label = "Cargo CycloneDX SBOM",
    packageName,
    packageVersion,
    rootPath,
  },
) {
  assertPackageName(packageName);
  assertPackageName(packageVersion);
  assertPackageName(boundary);
  const metadata = parseStrictJson(metadataInput, `${label} Cargo metadata`);
  const lockEntries = parseCargoLock(lockInput, `${label} Cargo.lock`);
  if (
    !isRecord(metadata) ||
    metadata.version !== 1 ||
    !Array.isArray(metadata.packages) ||
    !Array.isArray(metadata.workspace_members) ||
    !isRecord(metadata.resolve) ||
    !Array.isArray(metadata.resolve.nodes)
  ) {
    throw new Error(`${label} requires complete Cargo metadata format 1`);
  }

  const packageById = new Map(
    metadata.packages
      .filter(isRecord)
      .map((packageEntry) => [packageEntry.id, packageEntry]),
  );
  const nodeById = new Map(
    metadata.resolve.nodes.filter(isRecord).map((node) => [node.id, node]),
  );
  const reachableIds = collectReachableCargoIds(
    metadata.workspace_members,
    nodeById,
    label,
  );
  const referenceById = new Map();
  const components = [];

  for (const id of reachableIds) {
    const packageEntry = packageById.get(id);
    if (!isRecord(packageEntry)) {
      throw new Error(
        `${label} resolve graph references unknown package ${id}`,
      );
    }
    const component = cargoComponent(packageEntry, lockEntries, label);
    if (
      [...referenceById.values()].some(
        (existingReference) => existingReference === component["bom-ref"],
      )
    ) {
      throw new Error(
        `${label} has a duplicate Cargo package identity ${component["bom-ref"]}`,
      );
    }
    referenceById.set(id, component["bom-ref"]);
    components.push(component);
  }
  components.sort(compareComponents);

  const rootReference = `pkg:generic/${encodeURIComponent(packageName)}@${encodeURIComponent(packageVersion)}`;
  const dependencies = [
    {
      ref: rootReference,
      dependsOn: metadata.workspace_members
        .map((id) => referenceById.get(id))
        .filter((value) => typeof value === "string")
        .sort(),
    },
    ...reachableIds.map((id) => {
      const node = nodeById.get(id);
      return {
        ref: referenceById.get(id),
        dependsOn: runtimeCargoDependencyIds(node, label)
          .filter((dependencyId) => referenceById.has(dependencyId))
          .map((dependencyId) => referenceById.get(dependencyId))
          .sort(),
      };
    }),
  ].sort((left, right) => left.ref.localeCompare(right.ref));

  const sbom = {
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    components,
    dependencies,
    metadata: {
      component: {
        "bom-ref": rootReference,
        name: packageName,
        properties: [
          {
            name: "joessh:cargo:dependency-boundary",
            value: boundary,
          },
        ],
        purl: rootReference,
        type: "application",
        version: packageVersion,
      },
    },
    specVersion: "1.5",
    version: 1,
  };
  const leaks = findLocalPathLeaks(sbom, { packageName, rootPath });
  if (leaks.length > 0) {
    throw new Error(
      `${label} contains local path or worktree data:\n- ${leaks.join("\n- ")}`,
    );
  }
  return stableJson(sbom);
}

export function inspectCanonicalCargoCycloneDx(
  input,
  {
    boundary,
    label = "Cargo CycloneDX SBOM",
    packageName,
    packageVersion,
    rootPath,
  },
) {
  const errors = [];
  let json;
  let text;
  try {
    text = decodeStrictUtf8(input, label);
    json = JSON.parse(text);
  } catch (error) {
    return [error instanceof Error ? error.message : `${label} is invalid`];
  }
  if (!isRecord(json)) {
    return [`${label} must be a JSON object`];
  }
  if (
    json.bomFormat !== "CycloneDX" ||
    json.specVersion !== "1.5" ||
    json.version !== 1
  ) {
    errors.push(`${label} must use the reviewed CycloneDX 1.5 contract`);
  }
  if (
    Object.hasOwn(json, "serialNumber") ||
    (isRecord(json.metadata) && Object.hasOwn(json.metadata, "timestamp"))
  ) {
    errors.push(`${label} must not contain serialNumber or metadata.timestamp`);
  }
  const rootComponent = json.metadata?.component;
  if (
    !isRecord(rootComponent) ||
    rootComponent.name !== packageName ||
    rootComponent.version !== packageVersion ||
    rootComponent.type !== "application" ||
    !Array.isArray(rootComponent.properties) ||
    !rootComponent.properties.some(
      (property) =>
        isRecord(property) &&
        property.name === "joessh:cargo:dependency-boundary" &&
        property.value === boundary,
    )
  ) {
    errors.push(`${label} root component identity/boundary is invalid`);
  }
  if (!Array.isArray(json.components) || json.components.length === 0) {
    errors.push(`${label} must include reachable Cargo components`);
  } else {
    const references = new Set();
    for (const component of json.components) {
      const source = Array.isArray(component?.properties)
        ? component.properties.find(
            (property) =>
              isRecord(property) && property.name === "joessh:cargo:source",
          )?.value
        : undefined;
      if (
        !isRecord(component) ||
        component.type !== "library" ||
        typeof component["bom-ref"] !== "string" ||
        typeof component.name !== "string" ||
        typeof component.version !== "string" ||
        typeof component.purl !== "string" ||
        !Array.isArray(component.licenses) ||
        component.licenses.length === 0 ||
        typeof source !== "string" ||
        source === ""
      ) {
        errors.push(`${label} contains incomplete Cargo component evidence`);
        continue;
      }
      if (references.has(component["bom-ref"])) {
        errors.push(`${label} contains duplicate Cargo component references`);
      }
      references.add(component["bom-ref"]);
      if (
        source.startsWith("registry+") &&
        (!Array.isArray(component.hashes) ||
          !component.hashes.some(
            (hash) =>
              isRecord(hash) &&
              hash.alg === "SHA-256" &&
              /^[a-f0-9]{64}$/.test(hash.content),
          ))
      ) {
        errors.push(
          `${label} registry component is missing Cargo.lock SHA-256`,
        );
      }
    }
    if (!Array.isArray(json.dependencies)) {
      errors.push(`${label} must include a CycloneDX dependency graph`);
    } else {
      const allowedReferences = new Set([
        rootComponent?.["bom-ref"],
        ...references,
      ]);
      for (const dependency of json.dependencies) {
        if (
          !isRecord(dependency) ||
          !allowedReferences.has(dependency.ref) ||
          !Array.isArray(dependency.dependsOn) ||
          dependency.dependsOn.some(
            (reference) => !allowedReferences.has(reference),
          )
        ) {
          errors.push(
            `${label} dependency graph references unknown components`,
          );
          break;
        }
      }
    }
  }
  errors.push(
    ...findLocalPathLeaks(json, { packageName, rootPath }).map(
      (leak) => `${label} contains local path or worktree data: ${leak}`,
    ),
  );
  if (stableJson(json) !== text) {
    errors.push(`${label} must use stable sorted JSON with UTF-8 LF output`);
  }
  return errors;
}

function assertCycloneDxObject(json, label) {
  if (!isRecord(json)) {
    throw new Error(`${label} must be a JSON object`);
  }
  if (json.bomFormat !== "CycloneDX") {
    throw new Error(`${label} must use CycloneDX format`);
  }
  if (!isRecord(json.metadata) || !isRecord(json.metadata.component)) {
    throw new Error(`${label} must include metadata.component`);
  }
}

function assertPackageName(packageName) {
  if (typeof packageName !== "string" || packageName.trim() === "") {
    throw new Error("Root package.json name must be a non-empty string.");
  }
}

function cargoComponent(packageEntry, lockEntries, label) {
  const name = requireString(packageEntry.name, `${label} Cargo package name`);
  const version = requireString(
    packageEntry.version,
    `${label} ${name} version`,
  );
  const license = requireString(
    packageEntry.license,
    `${label} ${name}@${version} license`,
  );
  const source =
    packageEntry.source === null
      ? "workspace"
      : requireString(
          packageEntry.source,
          `${label} ${name}@${version} source`,
        );
  if (
    source !== "workspace" &&
    !/^registry\+https:\/\/[^/?#]+(?:\/[^?#]*)?$/i.test(source)
  ) {
    throw new Error(`${label} ${name}@${version} uses unsafe Cargo source`);
  }
  const purl = `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  const component = {
    "bom-ref": purl,
    licenses: [{ expression: license }],
    name,
    properties: [{ name: "joessh:cargo:source", value: source }],
    purl,
    scope: "required",
    type: "library",
    version,
  };
  if (source !== "workspace") {
    const lockEntry = lockEntries.get(cargoLockKey(name, version, source));
    if (!lockEntry || !/^[a-f0-9]{64}$/.test(lockEntry.checksum ?? "")) {
      throw new Error(
        `${label} ${name}@${version} is missing its Cargo.lock SHA-256`,
      );
    }
    component.hashes = [{ alg: "SHA-256", content: lockEntry.checksum }];
  }
  return component;
}

function parseCargoLock(input, label) {
  const text = decodeStrictUtf8(input, label)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const entries = new Map();
  let current = null;
  const flush = () => {
    if (!current) {
      return;
    }
    const name = requireString(current.name, `${label} package name`);
    const version = requireString(current.version, `${label} ${name} version`);
    if (current.source) {
      const key = cargoLockKey(name, version, current.source);
      if (entries.has(key)) {
        throw new Error(`${label} contains duplicate ${name}@${version}`);
      }
      entries.set(key, current);
    }
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "[[package]]") {
      flush();
      current = {};
      continue;
    }
    if (!current) {
      continue;
    }
    const match = line.match(
      /^(name|version|source|checksum) = ("(?:[^"\\]|\\.)*")$/,
    );
    if (match) {
      current[match[1]] = JSON.parse(match[2]);
    }
  }
  flush();
  return entries;
}

function cargoLockKey(name, version, source) {
  return `${name}\0${version}\0${source}`;
}

function collectReachableCargoIds(workspaceMembers, nodeById, label) {
  const queue = [...workspaceMembers];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift();
    const node = nodeById.get(id);
    if (!isRecord(node) || !Array.isArray(node.deps)) {
      throw new Error(`${label} resolve graph is missing node ${id}`);
    }
    for (const dependencyId of runtimeCargoDependencyIds(node, label)) {
      if (!seen.has(dependencyId)) {
        seen.add(dependencyId);
        queue.push(dependencyId);
      }
    }
  }
  return [...seen];
}

function runtimeCargoDependencyIds(node, label) {
  if (!isRecord(node) || !Array.isArray(node.deps)) {
    throw new Error(`${label} contains a malformed Cargo dependency node`);
  }
  return node.deps
    .filter((dependency) => {
      if (!isRecord(dependency)) {
        throw new Error(`${label} contains a malformed Cargo dependency edge`);
      }
      const kinds = Array.isArray(dependency.dep_kinds)
        ? dependency.dep_kinds
        : [];
      return !(
        kinds.length > 0 &&
        kinds.every((entry) => isRecord(entry) && entry.kind === "dev")
      );
    })
    .map((dependency) =>
      requireString(dependency.pkg, `${label} dependency package id`),
    );
}

function compareComponents(left, right) {
  return (
    left.name.localeCompare(right.name) ||
    left.version.localeCompare(right.version) ||
    left["bom-ref"].localeCompare(right["bom-ref"])
  );
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function findLocalPathLeaks(json, { packageName, rootPath }) {
  const leaks = new Set();
  const normalizedRoot = resolve(rootPath).replaceAll("\\", "/");
  const rootName = basename(resolve(rootPath));

  visitStrings(json, "$", (value, jsonPath) => {
    const normalized = value.replaceAll("\\", "/");
    if (
      normalized.includes(normalizedRoot) ||
      /(?:path\+)?file:\/\/+/i.test(normalized) ||
      /(?:^|[\s"'=(])(?:[A-Za-z]:\/|\/(?:Users|home|tmp|var|private|workspace|workspaces|mnt|opt|runner)(?:\/|$))/i.test(
        normalized,
      )
    ) {
      leaks.add(`${jsonPath} contains an absolute local path`);
    }
    // npm copies the source-controlled package description into this field. A
    // public product name may legitimately equal the hosted checkout basename.
    const isRootComponentDescription =
      jsonPath === "$.metadata.component.description";
    if (
      rootName &&
      rootName !== packageName &&
      !isRootComponentDescription &&
      normalized
        .toLocaleLowerCase("en-US")
        .includes(rootName.toLocaleLowerCase("en-US"))
    ) {
      leaks.add(`${jsonPath} contains checkout name ${rootName}`);
    }
  });
  return [...leaks].sort();
}

function visitStrings(value, path, visit) {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      visitStrings(entry, `${path}[${index}]`, visit),
    );
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    visitStrings(entry, `${path}.${key}`, visit);
  }
}

function stableJson(value) {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function parseStrictJson(input, label) {
  const text = decodeStrictUtf8(input, label)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function decodeStrictUtf8(input, label) {
  if (typeof input === "string") {
    if (input.includes("\0")) {
      throw new Error(`${label} must not contain NUL bytes`);
    }
    return input;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
  if (text.includes("\0")) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  return text;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
