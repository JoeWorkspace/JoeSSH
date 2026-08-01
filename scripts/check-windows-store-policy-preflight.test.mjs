import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  loadPartnerIdentity,
  routeStorePolicyPreflightArgs,
  runStorePolicyPreflight,
} from "./check-windows-store-policy-preflight.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("routes Store policy CLI values to the checker that owns each option", () => {
  const routed = routeStorePolicyPreflightArgs([
    "--partner-identity",
    "reports/handoff/windows-store/partner-center-identity.json",
    "--support-url",
    "https://joessh.dev/support",
    "--privacy-url=https://joessh.dev/privacy",
    "--confirm-public-links",
  ]);

  assert.deepEqual(routed, {
    commercialArgs: [
      "--mode",
      "store",
      "--support-url",
      "https://joessh.dev/support",
      "--privacy-url",
      "https://joessh.dev/privacy",
      "--confirm-public-links",
    ],
    partnerIdentityPath:
      "reports/handoff/windows-store/partner-center-identity.json",
    publicPageArgs: [
      "--support-url",
      "https://joessh.dev/support",
      "--privacy-url",
      "https://joessh.dev/privacy",
    ],
  });
});

test("rejects unknown, missing, valued-boolean, and repeated options", () => {
  assert.throws(
    () => routeStorePolicyPreflightArgs([]),
    /--partner-identity is required/,
  );
  assert.throws(
    () => routeStorePolicyPreflightArgs(["--merchant-of-record", "Merchant"]),
    /Unknown Store policy preflight option/,
  );
  assert.throws(
    () => routeStorePolicyPreflightArgs(["--privacy-url", "--support-url"]),
    /--privacy-url requires a value/,
  );
  assert.throws(
    () => routeStorePolicyPreflightArgs(["--confirm-public-links=true"]),
    /does not accept a value/,
  );
  assert.throws(
    () =>
      routeStorePolicyPreflightArgs([
        "--partner-identity",
        "first.json",
        "--partner-identity",
        "second.json",
      ]),
    /--partner-identity must be supplied at most once/,
  );
  assert.throws(
    () =>
      routeStorePolicyPreflightArgs([
        "--seller-name",
        "Personal Name Must Not Enter Argv",
      ]),
    /Unknown Store policy preflight option/,
  );
});

test("runs commercial first and public pages only after commercial passes", () => {
  const calls = [];
  const spawnSyncFn = (executable, args, options) => {
    calls.push({ args, executable, options });
    return { status: calls.length === 1 ? 0 : 7 };
  };
  const privateName = "Private Name Sentinel";
  const status = runStorePolicyPreflight(
    [
      "--partner-identity",
      "private-identity.json",
      "--support-url",
      "https://joessh.dev/support",
      "--privacy-url",
      "https://joessh.dev/privacy",
      "--confirm-public-links",
    ],
    {
      loadPartnerIdentityFn: (path, cwd) => {
        assert.equal(path, "private-identity.json");
        assert.equal(cwd, repositoryRoot);
        return { publisherDisplayName: privateName };
      },
      spawnSyncFn,
    },
  );

  assert.equal(status, 7);
  assert.equal(calls.length, 2);
  assert.match(calls[0].args[0], /check-commercial-release-readiness\.mjs$/);
  assert.deepEqual(calls[0].args.slice(1, 3), ["--mode", "store"]);
  assert.doesNotMatch(JSON.stringify(calls[0].args), new RegExp(privateName));
  assert.equal(calls[0].options.env.JOESSH_SELLER_LEGAL_NAME, privateName);
  assert.equal(
    calls[0].options.env.ATLASTERM_WINDOWS_LEGAL_PUBLISHER,
    privateName,
  );
  assert.match(calls[1].args[0], /check-store-public-pages\.mjs$/);
  assert.deepEqual(calls[1].args.slice(1), [
    "--support-url",
    "https://joessh.dev/support",
    "--privacy-url",
    "https://joessh.dev/privacy",
  ]);
  assert.ok(calls.every(({ options }) => options.cwd === repositoryRoot));
});

test("loads only a canonical local Partner Center identity", (t) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "store-policy-identity-"));
  t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));
  const identityDirectory = join(
    temporaryRoot,
    "reports",
    "handoff",
    "windows-store",
  );
  mkdirSync(identityDirectory, { recursive: true });
  const identityPath = join(identityDirectory, "identity.json");
  const identity = {
    schemaVersion: 1,
    source: "partner-center",
    productId: "9N1234567890",
    packageIdentityName: "Test.Package.Assigned",
    publisher: "CN=01234567-89ab-cdef-0123-456789abcdef",
    publisherDisplayName: "Verified Test Individual",
    publisherId: "8wekyb3d8bbwe",
    packageFamilyName: "Test.Package.Assigned_8wekyb3d8bbwe",
    reservedAt: "2020-01-01T00:00:00.000Z",
  };
  writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`);

  assert.equal(
    loadPartnerIdentity(identityPath, temporaryRoot).publisherDisplayName,
    identity.publisherDisplayName,
  );
  writeFileSync(
    identityPath,
    `${JSON.stringify({ ...identity, token: "must-not-be-accepted" })}\n`,
  );
  assert.throws(
    () => loadPartnerIdentity(identityPath, temporaryRoot),
    /must contain only the canonical identity fields/,
  );

  const trackedPath = join(temporaryRoot, "tracked-identity.json");
  writeFileSync(trackedPath, `${JSON.stringify(identity)}\n`);
  assert.throws(
    () => loadPartnerIdentity(trackedPath, temporaryRoot),
    /must stay below reports\/handoff\/windows-store/,
  );
});

test("does not perform a network check after commercial policy failure", () => {
  let calls = 0;
  const status = runStorePolicyPreflight(
    ["--partner-identity", "private-identity.json"],
    {
      loadPartnerIdentityFn: () => ({
        publisherDisplayName: "Private Name Sentinel",
      }),
      spawnSyncFn: () => {
        calls += 1;
        return { status: 1 };
      },
    },
  );

  assert.equal(status, 1);
  assert.equal(calls, 1);
});

test("package preflight leaves appended npm arguments on the routing wrapper", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
  );
  assert.match(
    packageJson.scripts["release:windows-store:policy-preflight"],
    /node scripts\/check-windows-store-policy-preflight\.mjs$/,
  );
});
