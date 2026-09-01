import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { verifyVendoredNpmPackages } from "./vendored-npm-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const vendorRelativePath = "vendor/decode-uri-component-0.5.0";
const vendorRoot = resolve(root, vendorRelativePath);
const manifest = readJson(resolve(vendorRoot, "JOESSH-PATCH.json"));
const rootPackage = readJson(resolve(root, "package.json"));
const packageLock = readJson(resolve(root, "package-lock.json"));
const require = createRequire(import.meta.url);

test("pins every vendored decoder file to the reviewed npm release and compatibility patch", () => {
  const records = verifyVendoredNpmPackages(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "decode-uri-component");
  assert.equal(records[0].version, "0.5.0");
  assert.match(records[0].treeSha256, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(records[0]));

  assert.deepEqual(manifest.package, {
    name: "decode-uri-component",
    version: "0.5.0",
    license: "MIT",
  });
  assert.deepEqual(manifest.source, {
    archive:
      "https://registry.npmjs.org/decode-uri-component/-/decode-uri-component-0.5.0.tgz",
    integrity:
      "sha512-1BiQVoK8C9gUbQU6NzAtO/tkz2qOFpEObMWpcFvhx4fYnj4Oc5yzaJN/LD36ihkVUdXyh5ZekzX+yM+ty/SrPg==",
    shasum: "4592fa1e1d640ec5e2760e2e168ad2ab5f2c9da1",
    repository: "https://github.com/SamVerschueren/decode-uri-component",
    gitCommit: "a12fabaa28303cc8b5b07e93d128f4fc09fc31e5",
    securityFixCommit: "fa479dafeede7bedf04e5c89aa78f2a78c664005",
    advisory: "https://github.com/advisories/GHSA-vcc3-ghjq-m6fr",
  });

  const actualFiles = readdirSync(vendorRoot)
    .filter((name) => name !== "JOESSH-PATCH.json")
    .sort();
  assert.deepEqual(actualFiles, Object.keys(manifest.files).sort());

  for (const [path, record] of Object.entries(manifest.files)) {
    assert.match(record.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(sha256(resolve(vendorRoot, path)), record.sha256, path);
  }

  const esmSource = readFileSync(resolve(vendorRoot, "index.js"), "utf8");
  const commonJsSource = readFileSync(resolve(vendorRoot, "index.cjs"), "utf8");
  const marker = "export default function decodeUriComponent(encodedURI) {";
  assert.equal(esmSource.split(marker).length - 1, 1);
  assert.equal(
    commonJsSource,
    esmSource.replace(
      marker,
      "module.exports = function decodeUriComponent(encodedURI) {",
    ),
  );

  const vendoredPackage = readJson(resolve(vendorRoot, "package.json"));
  const upstreamPackage = readJson(
    resolve(vendorRoot, "package.original.json"),
  );
  const expectedPackage = {
    ...upstreamPackage,
    main: "./index.cjs",
    module: "./index.js",
    types: "./index.d.ts",
    exports: {
      types: "./index.d.ts",
      import: "./index.js",
      require: "./index.cjs",
      default: "./index.js",
    },
    files: ["index.js", "index.cjs", "index.d.ts"],
  };
  delete expectedPackage.scripts;
  delete expectedPackage.devDependencies;
  delete expectedPackage.overrides;
  delete expectedPackage.tsd;
  assert.deepEqual(vendoredPackage, expectedPackage);
  assert.deepEqual(vendoredPackage.author, upstreamPackage.author);

  const prettierIgnore = readFileSync(resolve(root, ".prettierignore"), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim());
  assert.ok(prettierIgnore.includes(`${vendorRelativePath}/**`));
  const attributes = readFileSync(resolve(root, ".gitattributes"), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim());
  assert.ok(
    attributes.includes(
      `${vendorRelativePath}/** -text whitespace=-blank-at-eol,-blank-at-eof`,
    ),
  );
});

test("locks every query-string decoder edge to the reviewed CommonJS bridge", () => {
  const dependencySpec = `file:${vendorRelativePath}`;
  assert.equal(
    rootPackage.dependencies?.["decode-uri-component"],
    dependencySpec,
  );
  assert.equal(
    rootPackage.overrides?.["decode-uri-component"],
    "$decode-uri-component",
  );
  assert.equal(
    packageLock.packages?.[""]?.dependencies?.["decode-uri-component"],
    dependencySpec,
  );
  assert.deepEqual(
    packageLock.packages?.["node_modules/decode-uri-component"],
    {
      resolved: vendorRelativePath,
      link: true,
    },
  );
  assert.deepEqual(packageLock.packages?.[vendorRelativePath], {
    name: "decode-uri-component",
    version: "0.5.0",
    license: "MIT",
    engines: { node: ">=14.16" },
  });

  const queryStringLock = packageLock.packages?.["node_modules/query-string"];
  assert.equal(queryStringLock?.version, "7.1.3");
  assert.equal(
    queryStringLock?.dependencies?.["decode-uri-component"],
    "^0.2.2",
    "the upstream edge stays visible while the root override replaces it",
  );
});

test("keeps ESM, CommonJS, query-string, and Expo Router decoding compatible", async () => {
  const commonJsDecoder = require(resolve(vendorRoot, "index.cjs"));
  const esmDecoder = (
    await import(pathToFileURL(resolve(vendorRoot, "index.js")).href)
  ).default;
  assert.equal(typeof commonJsDecoder, "function");
  assert.equal(typeof esmDecoder, "function");

  const cases = new Map([
    ["%25", "%"],
    ["%", "%"],
    ["st%C3%A5le", "ståle"],
    ["%st%C3%A5le%", "%ståle%"],
    ["%%7Bst%C3%A5le%7D%", "%{ståle}%"],
    ["%7B%ab%%7C%de%%7D", "{%ab%|%de%}"],
    ["%FE%FF", "��"],
    ["%C2", "�"],
    ["+", "+"],
  ]);
  for (const [input, expected] of cases) {
    assert.equal(commonJsDecoder(input), expected, input);
    assert.equal(esmDecoder(input), expected, input);
  }

  const installedDecoder = require("decode-uri-component");
  assert.equal(typeof installedDecoder, "function");
  assert.equal(
    resolve(require.resolve("decode-uri-component")),
    resolve(vendorRoot, "index.cjs"),
  );

  const queryString = require("query-string");
  assert.equal(typeof queryString.parse, "function");
  assert.equal(typeof queryString.stringify, "function");
  assert.deepEqual(
    { ...queryString.parse("term=hello+world&utf8=st%C3%A5le&a=1&a=2") },
    { a: ["1", "2"], term: "hello world", utf8: "ståle" },
  );
  assert.equal(
    queryString.stringify(
      { term: "hello world", utf8: "ståle" },
      { sort: false },
    ),
    "term=hello%20world&utf8=st%C3%A5le",
  );

  const { getStateFromPath } = require(
    resolve(
      root,
      "node_modules/expo-router/build/react-navigation/core/getStateFromPath.js",
    ),
  );
  const { getPathFromState } = require(
    resolve(
      root,
      "node_modules/expo-router/build/react-navigation/core/getPathFromState.js",
    ),
  );
  const routeConfig = { screens: { Search: "search" } };
  const state = getStateFromPath(
    "/search?term=hello+world&utf8=st%C3%A5le&broken=%ea%ba%5a%ba",
    routeConfig,
  );
  assert.equal(state.routes[0].name, "Search");
  assert.deepEqual(state.routes[0].params, {
    broken: "%ea%baZ%ba",
    term: "hello world",
    utf8: "ståle",
  });
  assert.equal(
    getPathFromState(
      {
        routes: [
          {
            name: "Search",
            params: { term: "hello world", utf8: "ståle" },
          },
        ],
      },
      routeConfig,
    ),
    "/search?term=hello%20world&utf8=st%C3%A5le",
  );
});

test("decodes adversarial malformed query input within a fail-closed timeout", () => {
  const queryStringPath = resolve(root, "node_modules/query-string");
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      "const queryString=require(process.argv[1]); const input='%ab'.repeat(400); const parsed=queryString.parse('value='+input); if (typeof parsed.value !== 'string') process.exit(2);",
      queryStringPath,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    },
  );

  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr);
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
