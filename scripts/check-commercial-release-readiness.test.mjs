import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(
  new URL("./check-commercial-release-readiness.mjs", import.meta.url),
);
const requiredFiles = [
  ".github/FUNDING.yml",
  ".github/funding-operator-attestation.json",
  "PRIVACY.md",
  "REFUND_POLICY.md",
  "SUPPORT.md",
  "TERMS_OF_SALE.md",
  "THIRD_PARTY_NOTICES.md",
  "TRADEMARKS.md",
  "docs/commercial-release-readiness.md",
  "docs/funding-and-checkout.md",
  "docs/pricing-hypotheses.md",
  "docs/voluntary-support.md",
  "docs/assets/funding/alipay-support-qr.jpg",
  "docs/assets/funding/wechat-support-qr.jpg",
];

function createFixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "commercial-readiness-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const defaults = {
    ".github/FUNDING.yml": "# Intentionally empty\n",
    ".github/funding-operator-attestation.json": canonicalJson(
      inactiveFundingAttestation(),
    ),
    "PRIVACY.md": "# Privacy\nController: {{SELLER_LEGAL_NAME}}\n",
    "REFUND_POLICY.md":
      "# Refunds\nNo paid offer is active. {{SUPPORT_CONTACT}}\n",
    "SUPPORT.md":
      "# Support\nCommunity is free and MIT-licensed. Paid support is not currently available. {{SUPPORT_CONTACT}}\n",
    "TERMS_OF_SALE.md":
      "# Terms\nCommunity is free under the MIT License. Pro is not currently for sale. {{SELLER_LEGAL_NAME}}\n",
    "THIRD_PARTY_NOTICES.md": "# Third-party notices\n",
    "TRADEMARKS.md": "# Trademarks\n{{TRADEMARK_OWNER}}\n",
    "docs/commercial-release-readiness.md": "# Readiness\n",
    "docs/funding-and-checkout.md": "# Funding\n",
    "docs/pricing-hypotheses.md":
      "# Pricing\nCommunity is permanently free and MIT-licensed.\n",
    "docs/voluntary-support.md":
      "# Voluntary support\nSupport is voluntary and is not a purchase.\n",
    "docs/assets/funding/alipay-support-qr.jpg": "test asset\n",
    "docs/assets/funding/wechat-support-qr.jpg": "test asset\n",
    ...overrides,
  };
  for (const relativePath of requiredFiles) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, defaults[relativePath], "utf8");
  }
  return root;
}

function run(root, mode, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [scriptPath, "--root", root, "--mode", mode, "--json", ...extraArgs],
    { encoding: "utf8" },
  );
}

function inactiveFundingAttestation() {
  return {
    schemaVersion: 1,
    status: "inactive",
    fundingUrl: null,
    verifiedAt: null,
    checks: {
      destinationOwnedByVerifiedOperator: false,
      loggedOutPageReachable: false,
      smallPaymentCompleted: false,
      paymentLimitationsAndNonPurchaseWordingVerified: false,
      payoutCompleted: false,
    },
  };
}

function verifiedFundingAttestation(
  fundingUrl,
  verifiedAt = isoDateOffset(-1),
) {
  return {
    schemaVersion: 1,
    status: "verified",
    fundingUrl,
    verifiedAt,
    checks: {
      destinationOwnedByVerifiedOperator: true,
      loggedOutPageReachable: true,
      smallPaymentCompleted: true,
      paymentLimitationsAndNonPurchaseWordingVerified: true,
      payoutCompleted: true,
    },
  };
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isoDateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("community mode accepts fail-closed commercial templates", (t) => {
  const result = run(createFixture(t), "community");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).decision, "pass");
});

test("community mode rejects an active unverified funding destination", (t) => {
  const root = createFixture(t, {
    ".github/FUNDING.yml": "custom:\n  - VERIFIED_HTTPS_FUNDING_URL\n",
  });
  const result = run(root, "community");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /funding:no-placeholder/);
  assert.match(result.stdout, /funding:provider/);
});

test("store mode keeps tracked policies fail-closed while public pages are checked separately", (t) => {
  const seller = "Verified Test Individual";
  const supportUrl = "https://joessh.dev/support";
  const privacyUrl = "https://joessh.dev/privacy";
  const result = run(createFixture(t), "store", [
    "--seller-name",
    seller,
    "--windows-legal-publisher",
    seller,
    "--support-url",
    supportUrl,
    "--privacy-url",
    privacyUrl,
    "--confirm-public-links",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(seller));
  assert.equal(JSON.parse(result.stdout).decision, "pass");
});

test("store mode rejects committing the personal publisher identity to tracked policies", (t) => {
  const seller = "Verified Test Individual";
  const root = createFixture(t, {
    "PRIVACY.md": `# Privacy\nController: ${seller}\n`,
  });
  const result = run(root, "store", [
    "--seller-name",
    seller,
    "--windows-legal-publisher",
    seller,
    "--support-url",
    "https://joessh.dev/support",
    "--privacy-url",
    "https://joessh.dev/privacy",
    "--confirm-public-links",
  ]);

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(seller));
  assert.ok(
    JSON.parse(result.stdout).checks.some(
      (check) =>
        check.id === "store:publisher-identity-not-tracked" && !check.ok,
    ),
  );
});

test("paid mode cannot pass on policy wording alone", (t) => {
  const completed = {
    "PRIVACY.md": "# Privacy\nController: Joe Developer\n",
    "REFUND_POLICY.md": "# Refunds\nContact the verified support form.\n",
    "SUPPORT.md":
      "# Support\nCommunity is free and MIT-licensed. Paid support terms are listed at checkout.\n",
    "TERMS_OF_SALE.md":
      "# Terms\nCommunity is free under the MIT License. Seller: Joe Developer.\n",
    "TRADEMARKS.md": "# Trademarks\nOwner: Joe Developer.\n",
  };
  const result = run(createFixture(t, completed), "paid");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /paid:live-flow-confirmed/);
  assert.match(result.stdout, /store:public-links-confirmed/);
});

test("paid mode passes only with bound public facts and live-flow attestations", (t) => {
  const seller = "Joe Dev Studio";
  const merchant = "Global Merchant Services Ltd";
  const governingLaw =
    "Mandatory consumer law and the law of the seller jurisdiction";
  const supportUrl = "https://joessh.dev/support";
  const privacyUrl = "https://joessh.dev/privacy";
  const checkoutUrl = "https://buy.joessh.dev/pro";
  const customerPortalUrl = "https://buy.joessh.dev/portal";
  const completed = {
    "PRIVACY.md": `# Privacy\nController: ${seller}\nProcessor: ${merchant}\n`,
    "REFUND_POLICY.md": `# Refunds\nSupport: ${supportUrl}\nPortal: ${customerPortalUrl}\n`,
    "SUPPORT.md": `# Support\nCommunity is free and MIT-licensed.\nPaid support terms are listed at checkout.\nSupport: ${supportUrl}\n`,
    "TERMS_OF_SALE.md": `# Terms\nCommunity is free under the MIT License.\nSeller: ${seller}\nMerchant: ${merchant}\nLaw: ${governingLaw}\n`,
    "TRADEMARKS.md": `# Trademarks\nOwner: ${seller}.\n`,
  };
  const result = run(createFixture(t, completed), "paid", [
    "--seller-name",
    seller,
    "--merchant-of-record",
    merchant,
    "--governing-law",
    governingLaw,
    "--support-url",
    supportUrl,
    "--privacy-url",
    privacyUrl,
    "--checkout-url",
    checkoutUrl,
    "--customer-portal-url",
    customerPortalUrl,
    "--confirm-public-links",
    "--confirm-live-commerce",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).decision, "pass");
});

test("store mode binds the public seller to the protected Windows legal publisher", (t) => {
  const seller = "Joe Dev Studio";
  const supportUrl = "https://joessh.dev/support";
  const privacyUrl = "https://joessh.dev/privacy";
  const root = createFixture(t, {
    "PRIVACY.md": "# Privacy\nRendered Store policy is hosted separately.\n",
    "SUPPORT.md": "# Support\nCommunity is free and MIT-licensed.\n",
  });
  const baseArgs = [
    "--seller-name",
    seller,
    "--support-url",
    supportUrl,
    "--privacy-url",
    privacyUrl,
    "--confirm-public-links",
  ];

  const matching = run(root, "store", [
    ...baseArgs,
    "--windows-legal-publisher",
    seller,
  ]);
  assert.equal(matching.status, 0, matching.stderr || matching.stdout);

  const mismatched = run(root, "store", [
    ...baseArgs,
    "--windows-legal-publisher",
    "Different Legal Publisher",
  ]);
  assert.equal(mismatched.status, 1);
  assert.ok(
    JSON.parse(mismatched.stdout).checks.some(
      (check) => check.id === "store:seller-publisher-binding" && !check.ok,
    ),
  );
});

test("commercial URL checks reject local, private, reserved, and single-label hosts", async (t) => {
  const seller = "Joe Dev Studio";
  const completed = {
    "PRIVACY.md": "# Privacy\nRendered Store policy is hosted separately.\n",
    "SUPPORT.md": "# Support\nCommunity is free and MIT-licensed.\n",
  };
  const rejectedHosts = [
    "localhost",
    "localhost.",
    "service.localhost",
    "service.local",
    "service.localdomain",
    "service.internal",
    "router.home.arpa",
    "intranet",
    "127.0.0.1",
    "127.1",
    "2130706433",
    "0x7f000001",
    "017700000001",
    "10.0.0.4",
    "172.16.1.2",
    "192.168.10.20",
    "169.254.1.1",
    "100.64.0.1",
    "192.0.2.10",
    "198.51.100.10",
    "203.0.113.10",
    "[::1]",
    "[fc00::1]",
    "[fe80::1]",
    "[2001:db8::1]",
    "[::ffff:127.0.0.1]",
    "[::7f00:1]",
    "[100::1]",
    "example.com",
    "example.com.",
    "checkout.example.org",
    "service.test",
  ];

  for (const host of rejectedHosts) {
    await t.test(host, () => {
      const result = run(createFixture(t, completed), "store", [
        "--seller-name",
        seller,
        "--windows-legal-publisher",
        seller,
        "--support-url",
        `https://${host}/support`,
        "--privacy-url",
        "https://joessh.dev/privacy",
        "--confirm-public-links",
      ]);
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.ok(
        report.checks.some(
          (check) => check.id === "store:support-url" && !check.ok,
        ),
        `${host} must not be accepted as public HTTPS`,
      );
    });
  }
});

test("commercial URL checks reject query-bearing public URLs", (t) => {
  const seller = "Verified Test Individual";
  const result = run(createFixture(t), "store", [
    "--seller-name",
    seller,
    "--windows-legal-publisher",
    seller,
    "--support-url",
    "https://joessh.dev/support?preview_token=secret",
    "--privacy-url",
    "https://joessh.dev/privacy",
    "--confirm-public-links",
  ]);

  assert.equal(result.status, 1);
  assert.ok(
    JSON.parse(result.stdout).checks.some(
      (check) => check.id === "store:support-url" && !check.ok,
    ),
  );
});

test("active funding passes ordinary CI only with a current persistent attestation", (t) => {
  const fundingUrl = "https://afdian.com/a/joessh";
  const withoutPersistentEvidence = createFixture(t, {
    ".github/FUNDING.yml": `custom:\n  - ${fundingUrl}\n`,
  });
  const withoutAttestation = run(withoutPersistentEvidence, "community");
  assert.equal(withoutAttestation.status, 1);
  assert.match(withoutAttestation.stdout, /funding:operator-attestation/);

  const root = createFixture(t, {
    ".github/FUNDING.yml": `custom:\n  - ${fundingUrl}\n`,
    ".github/funding-operator-attestation.json": canonicalJson(
      verifiedFundingAttestation(fundingUrl),
    ),
  });
  const verified = run(root, "community");
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);

  const cliPreflight = run(root, "community", [
    "--funding-url",
    fundingUrl,
    "--confirm-funding-verified",
  ]);
  assert.equal(
    cliPreflight.status,
    0,
    cliPreflight.stderr || cliPreflight.stdout,
  );
});

test("optional funding CLI preflight does not activate comments-only funding", (t) => {
  const result = run(createFixture(t), "community", [
    "--funding-url",
    "https://afdian.com/a/joessh",
    "--confirm-funding-verified",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /funding:cli-preflight/);
});

test("funding attestation rejects URL drift and CLI cannot override it", (t) => {
  const fundingUrl = "https://afdian.com/a/joessh";
  const root = createFixture(t, {
    ".github/FUNDING.yml": `custom:\n  - ${fundingUrl}\n`,
    ".github/funding-operator-attestation.json": canonicalJson(
      verifiedFundingAttestation("https://afdian.com/a/not-joessh"),
    ),
  });
  const result = run(root, "community", [
    "--funding-url",
    fundingUrl,
    "--confirm-funding-verified",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /funding:attestation-url/);
  assert.match(result.stdout, /funding:operator-attestation/);
});

test("funding attestation rejects missing, false, and extra fields", async (t) => {
  const fundingUrl = "https://afdian.com/a/joessh";
  const mutations = [
    [
      "missing check",
      (value) => {
        delete value.checks.payoutCompleted;
      },
    ],
    [
      "false check",
      (value) => {
        value.checks.smallPaymentCompleted = false;
      },
    ],
    [
      "extra field",
      (value) => {
        value.operatorNote = "not reviewed";
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, (subtest) => {
      const attestation = verifiedFundingAttestation(fundingUrl);
      mutate(attestation);
      const root = createFixture(subtest, {
        ".github/FUNDING.yml": `custom:\n  - ${fundingUrl}\n`,
        ".github/funding-operator-attestation.json": canonicalJson(attestation),
      });
      const result = run(root, "community");
      assert.equal(result.status, 1);
      assert.match(result.stdout, /funding:attestation-(?:structure|checks)/);
    });
  }
});

test("funding attestation rejects future, impossible, and expired dates", async (t) => {
  const fundingUrl = "https://afdian.com/a/joessh";
  const invalidDates = [
    ["future", isoDateOffset(1)],
    ["impossible", "2026-02-30"],
    ["expired", isoDateOffset(-181)],
  ];
  for (const [name, verifiedAt] of invalidDates) {
    await t.test(name, (subtest) => {
      const root = createFixture(subtest, {
        ".github/FUNDING.yml": `custom:\n  - ${fundingUrl}\n`,
        ".github/funding-operator-attestation.json": canonicalJson(
          verifiedFundingAttestation(fundingUrl, verifiedAt),
        ),
      });
      const result = run(root, "community", [
        "--funding-url",
        fundingUrl,
        "--confirm-funding-verified",
      ]);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /funding:attestation-date/);
      assert.match(result.stdout, /funding:operator-attestation/);
    });
  }
});

test("funding attestation rejects non-canonical JSON and duplicate-key representations", async (t) => {
  const fundingUrl = "https://afdian.com/a/joessh";
  const valid = verifiedFundingAttestation(fundingUrl);
  const candidates = [
    JSON.stringify(valid),
    canonicalJson(valid).replace(
      '  "schemaVersion": 1,',
      '  "schemaVersion": 1,\n  "schemaVersion": 1,',
    ),
  ];
  for (const candidate of candidates) {
    await t.test("invalid representation", (subtest) => {
      const root = createFixture(subtest, {
        ".github/FUNDING.yml": `custom:\n  - ${fundingUrl}\n`,
        ".github/funding-operator-attestation.json": candidate,
      });
      const result = run(root, "community");
      assert.equal(result.status, 1);
      assert.match(result.stdout, /funding:attestation-json/);
    });
  }
});

test("comments-only funding rejects stale verified evidence", (t) => {
  const root = createFixture(t, {
    ".github/funding-operator-attestation.json": canonicalJson(
      verifiedFundingAttestation("https://afdian.com/a/joessh"),
    ),
  });
  const result = run(root, "community");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /funding:attestation-inactive/);
});

test("commercial identities reject padded and control-bearing evidence", (t) => {
  const root = createFixture(t, {
    "PRIVACY.md": "# Privacy\nController: Joe Dev Studio\n",
    "SUPPORT.md":
      "# Support\nCommunity is free and MIT-licensed.\nhttps://joessh.dev/support\n",
  });
  for (const seller of [
    " Joe Dev Studio",
    "Joe Dev Studio ",
    "Joe Dev\nStudio",
    "Joe Dev\u0001Studio",
    "Joe\u200bDev Studio",
  ]) {
    const result = run(root, "store", [
      "--seller-name",
      seller,
      "--windows-legal-publisher",
      seller,
      "--support-url",
      "https://joessh.dev/support",
      "--privacy-url",
      "https://joessh.dev/privacy",
      "--confirm-public-links",
    ]);
    assert.equal(result.status, 1);
    assert.ok(
      JSON.parse(result.stdout).checks.some(
        (check) => check.id === "store:seller" && !check.ok,
      ),
    );
  }
});
