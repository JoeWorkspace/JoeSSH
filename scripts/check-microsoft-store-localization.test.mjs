import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  checkMicrosoftStoreLocalization,
  checkMicrosoftStoreLocalizationManifest,
  checkMicrosoftStoreSubmissionReadiness,
} from "./check-microsoft-store-localization.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the 80-locale Store draft passes structural validation", () => {
  const failures = checkMicrosoftStoreLocalization(repositoryRoot).filter(
    (result) => !result.passed,
  );
  assert.deepEqual(failures, []);
});

test("the technical fact anchor gate accepts standard 25 MiB for ru-RU", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const entry = manifest.locales.find(
    (candidate) => candidate.locale === "ru-RU",
  );
  entry.listing.features[2] = entry.listing.features[2].replace(
    "25 МиБ",
    "25 MiB",
  );
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "technical fact anchors",
  );
  assert.equal(result?.passed, true);
});

test("the technical fact anchor gate accepts literal loopback for af-ZA", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const entry = manifest.locales.find(
    (candidate) => candidate.locale === "af-ZA",
  );
  entry.listing.features[3] = entry.listing.features[3].replace(
    "teruglus",
    "loopback",
  );
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "technical fact anchors",
  );
  assert.equal(result?.passed, true);
});

test("the technical fact anchor gate rejects a missing en-US x64 anchor", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const entry = manifest.locales.find(
    (candidate) => candidate.locale === "en-US",
  );
  entry.listing.shortDescription = entry.listing.shortDescription.replace(
    "x64",
    "x86",
  );
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "technical fact anchors",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /en-US:shortDescription\/x64/u);
});

test("the technical fact anchor gate rejects 250 MiB as the SFTP limit", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const entry = manifest.locales.find(
    (candidate) => candidate.locale === "en-US",
  );
  entry.listing.features[2] = entry.listing.features[2].replace(
    "25 MiB",
    "250 MiB",
  );
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "technical fact anchors",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /en-US:features\[2\]\/25 MiB/u);
});

test("the technical fact anchor gate rejects ২৫০ MiB as the Bengali SFTP limit", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const entry = manifest.locales.find(
    (candidate) => candidate.locale === "bn-IN",
  );
  entry.listing.features[2] = entry.listing.features[2].replace(
    "২৫ MiB",
    "২৫০ MiB",
  );
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "technical fact anchors",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /bn-IN:features\[2\]\/25 MiB/u);
});

test("the technical fact anchor gate rejects a missing af-ZA teruglus alias", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const entry = manifest.locales.find(
    (candidate) => candidate.locale === "af-ZA",
  );
  entry.listing.features[3] = entry.listing.features[3].replace("teruglus", "");
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "technical fact anchors",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /af-ZA:features\[3\]\/loopback/u);
});

test("the technical fact anchor gate rejects a missing ar-SA Public Beta anchor", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const entry = manifest.locales.find(
    (candidate) => candidate.locale === "ar-SA",
  );
  entry.listing.shortDescription = entry.listing.shortDescription.replace(
    "إصدار تجريبي عام",
    "",
  );
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "technical fact anchors",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /ar-SA:shortDescription\/Public Beta/u);
});

test("the generator output matches the tracked draft manifest", (t) => {
  const output = join(
    mkdtempSync(join(tmpdir(), "joessh-store-generator-")),
    "localization-manifest.json",
  );
  t.after(() => rmSync(output, { force: true }));
  const manifest = readManifest(repositoryRoot);
  execFileSync(
    process.execPath,
    [
      "scripts/generate-microsoft-store-localization.mjs",
      `--output=${output}`,
      `--generated-at=${manifest.generatedAt}`,
      `--localization-revision=${manifest.localizationRevision}`,
      `--candidate-artifact-source-commit=${manifest.candidateArtifactSourceCommit}`,
      `--generation-source-commit=${manifest.generation.sourceCommit}`,
      `--generation-source-state=${manifest.generation.sourceState}`,
    ],
    { cwd: repositoryRoot, stdio: "pipe" },
  );
  assert.equal(
    readFileSync(output, "utf8"),
    readFileSync(
      join(
        repositoryRoot,
        "docs/assets/microsoft-store/localization-manifest.json",
      ),
      "utf8",
    ),
  );
});

test("the generator rejects an unrecognized source-state override", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          "scripts/generate-microsoft-store-localization.mjs",
          "--output=" + join(tmpdir(), "joessh-invalid-source-state.json"),
          "--generation-source-state=not-evidence",
        ],
        { cwd: repositoryRoot, stdio: "pipe" },
      ),
    /Invalid --generation-source-state/u,
  );
});

test("all Store titles use the reserved JoeSSH product name", () => {
  const manifest = readManifest(repositoryRoot);
  assert.ok(
    manifest.locales.every((entry) => entry.listing.title === "JoeSSH"),
  );
});

test("regional Store listings may share an application UI pack", () => {
  const manifest = readManifest(repositoryRoot);
  assert.deepEqual(
    Object.fromEntries(
      ["en-GB", "es-MX", "pt-PT"].map((code) => {
        const entry = manifest.locales.find(
          (candidate) => candidate.locale === code,
        );
        return [code, [entry.appUiLocale, entry.appUiSupported]];
      }),
    ),
    {
      "en-GB": ["en", true],
      "es-MX": ["es", true],
      "pt-PT": ["pt-BR", true],
    },
  );
});

test("the target collection rejects a missing requested locale", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales = manifest.locales.filter(
    (entry) => entry.locale !== "cy-GB",
  );
  writeManifest(fixture, manifest);

  assert.equal(
    checkMicrosoftStoreLocalization(fixture).find(
      (result) => result.label === "canonical locale collection",
    )?.passed,
    false,
  );
});

test("the copy check rejects English fallback in a non-English listing", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const english = manifest.locales.find((entry) => entry.locale === "de-DE");
  const fallback = manifest.locales.find((entry) => entry.locale === "en-US");
  english.listing.shortDescription = fallback.listing.shortDescription;
  writeManifest(fixture, manifest);

  assert.equal(
    checkMicrosoftStoreLocalization(fixture).find(
      (result) => result.label === "fallback scan",
    )?.passed,
    false,
  );
});

test("the copy check rejects a lightly modified English fallback", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const english = manifest.locales.find((entry) => entry.locale === "de-DE");
  const fallback = manifest.locales.find((entry) => entry.locale === "en-US");
  english.listing.fullDescription = `${fallback.listing.fullDescription} `;
  writeManifest(fixture, manifest);

  assert.equal(
    checkMicrosoftStoreLocalization(fixture).find(
      (result) => result.label === "fallback scan",
    )?.passed,
    false,
  );
});

test("the Quechua draft avoids known translation error fragments", () => {
  const manifest = readManifest(repositoryRoot);
  const entry = manifest.locales.find(
    (candidate) => candidate.locale === "qu-PE",
  );
  const text = JSON.stringify(entry?.listing ?? {}).toLowerCase();
  for (const fragment of [
    "código",
    "servidor",
    "terminal interactivo",
    "archivokuna",
    "preferencias",
    "cuenta",
    "servicio alojado",
    "antes de importar",
    "puertos locales",
  ]) {
    assert.equal(text.includes(fragment), false, `found ${fragment}`);
  }
});

test("the Unicode audit rejects non-NFC and bidi/control injection", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales[0].listing.shortDescription = "e\u0301 SSH draft";
  manifest.locales[0].listing.fullDescription += "\u202e";
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "Unicode copy hygiene",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /af-ZA/u);
});

test("the script audit rejects a non-Latin listing replaced by technical English", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales.find(
    (entry) => entry.locale === "zh-CN",
  ).listing.shortDescription = "Free local SSH SFTP Windows x64 Public Beta";
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "target script coverage",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /zh-CN/u);
});

test("the script audit rejects a non-Latin listing in the wrong script", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales.find(
    (entry) => entry.locale === "zh-CN",
  ).listing.shortDescription = "Δωρεάν SSH SFTP Windows x64 Public Beta";
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "target script coverage",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /zh-CN/u);
});

test("the paragraph audit rejects a duplicate across unrelated languages", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const english = manifest.locales.find((entry) => entry.locale === "en-US");
  const german = manifest.locales.find((entry) => entry.locale === "de-DE");
  german.listing.fullDescription = english.listing.fullDescription;
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "cross-locale paragraph uniqueness",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /fullDescription:en-US,de-DE/u);
});

test("the draft validator rejects CSV formula-injection values", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales[0].listing.shortDescription =
    ' \t=HYPERLINK("https://example.invalid")';
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "CSV formula-injection safety",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /af-ZA/u);
});

test("the known translation error audit rejects a forbidden substring", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales.find(
    (entry) => entry.locale === "af-ZA",
  ).listing.fullDescription += " gashere-sleutels";
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "known translation error markers",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /af-ZA:fullDescription/u);
});

test("the known translation error audit rejects a forbidden exact listing field", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales.find(
    (entry) => entry.locale === "eu-ES",
  ).listing.features[3] = "Loopback bidezko ataka-birbidalketa lokala";
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "known translation error markers",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /eu-ES:features\[3\]/u);
});

test("the known translation error audit rejects a known Quechua contamination marker", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales.find(
    (entry) => entry.locale === "qu-PE",
  ).listing.fullDescription += " código";
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "known translation error markers",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /qu-PE/u);
});

test("the known keyword defect gate rejects recorded truncated fragments", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const vietnamese = manifest.locales.find((entry) => entry.locale === "vi-VN");
  vietnamese.listing.keywords[2] = "Thiết bị";
  const catalan = manifest.locales.find((entry) => entry.locale === "ca-ES");
  catalan.listing.keywords[3] = "Reenviament de";
  catalan.listing.keywords[4] = "Perfils de";
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "known keyword defect markers",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /vi-VN:terminal/u);
  assert.match(result?.detail ?? "", /ca-ES:portForwarding/u);
  assert.match(result?.detail ?? "", /ca-ES:connectionProfiles/u);
});

test("the known keyword defect gate covers every current override rollback", () => {
  const manifest = readManifest(repositoryRoot);
  const expected = new Set();
  const expectedByField = {
    terminal: 0,
    portForwarding: 0,
    connectionProfiles: 0,
  };
  const keywordFields = [
    { featureIndex: 1, keywordIndex: 2, field: "terminal" },
    { featureIndex: 3, keywordIndex: 3, field: "portForwarding" },
    { featureIndex: 4, keywordIndex: 4, field: "connectionProfiles" },
  ];

  for (const entry of manifest.locales) {
    for (const { featureIndex, keywordIndex, field } of keywordFields) {
      const current = entry.listing.keywords[keywordIndex];
      const legacy = legacyKeywordFragment(
        entry.listing.features[featureIndex],
      );
      if (legacy === current) continue;
      entry.listing.keywords[keywordIndex] = legacy;
      expected.add(`${entry.locale}:${field}`);
      expectedByField[field] += 1;
    }
  }

  assert.deepEqual(expectedByField, {
    terminal: 1,
    portForwarding: 62,
    connectionProfiles: 42,
  });
  assert.equal(expected.size, 105);

  const result = checkMicrosoftStoreLocalizationManifest(
    manifest,
    repositoryRoot,
  ).find((candidate) => candidate.label === "known keyword defect markers");
  assert.equal(result?.passed, false);

  const detected = new Set(
    (result?.detail ?? "")
      .split(", ")
      .filter(Boolean)
      .map((detail) => detail.slice(0, detail.indexOf("="))),
  );
  assert.equal(detected.size, expected.size);
  assert.deepEqual([...detected].sort(), [...expected].sort());
});

test("the claim check rejects publication and unsupported telemetry statements", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales[0].listing.fullDescription +=
    " Officially published and certified; telemetry is enabled.";
  writeManifest(fixture, manifest);

  assert.equal(
    checkMicrosoftStoreLocalization(fixture).find(
      (result) => result.label === "unsupported claims",
    )?.passed,
    false,
  );
});

test("the claim check rejects Spanish publication and paid-offer statements", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales[0].listing.fullDescription +=
    " Publicado en la Tienda Microsoft; es de pago y requiere suscripción.";
  writeManifest(fixture, manifest);

  assert.equal(
    checkMicrosoftStoreLocalization(fixture).find(
      (result) => result.label === "unsupported claims",
    )?.passed,
    false,
  );
});

test("draft status remains allowed while submission readiness fails closed", () => {
  const failures = checkMicrosoftStoreSubmissionReadiness(
    repositoryRoot,
  ).filter((result) => !result.passed);
  assert.ok(
    failures.some((result) => result.label === "native review approval"),
  );
  assert.ok(failures.some((result) => result.label === "screenshot binding"));
  assert.ok(
    failures.some((result) => result.label === "candidate source binding"),
  );
});

test("submission readiness can pass when every fail-closed evidence gate is satisfied", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const reviewedAt = "2026-08-05T15:32:55.110Z";
  for (const entry of manifest.locales) {
    entry.reviewStatus = "native-approved";
    entry.nativeReview = {
      reviewer: "TEST-FIXTURE-native-reviewer",
      reviewedAt,
      provenance: "TEST-FIXTURE-native-review-record",
    };
    entry.listing.assets = {
      screenshotUrls: [
        `https://developer.microsoft.com/test-fixture/${entry.storeLocale}.png`,
      ],
      screenshotBinding: {
        status: "reviewed",
        reviewer: "TEST-FIXTURE-screenshot-reviewer",
        reviewedAt,
        provenance: "TEST-FIXTURE-screenshot-record",
      },
    };
  }
  manifest.productSourceCommit = manifest.candidateArtifactSourceCommit;
  manifest.storeLocaleCatalog.status = "partner-center-export-confirmed";
  manifest.storeLocaleCatalog.confirmedAt = reviewedAt;
  manifest.storeLocaleCatalog.exportSha256 = "a".repeat(64);
  manifest.submissionStatus = "ready-for-human-submission";
  writeManifest(fixture, manifest);

  assert.deepEqual(
    checkMicrosoftStoreSubmissionReadiness(fixture).filter(
      (result) => !result.passed,
    ),
    [],
  );
});

test("the live Partner Center option evidence rejects catalog drift", (t) => {
  const fixture = createFixture(t);
  const evidencePath = join(
    fixture,
    "docs/assets/microsoft-store/partner-center-language-options.json",
  );
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  evidence.options[0].languageId = evidence.options[1].languageId;
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "Partner Center live language options",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /language-ids/u);
});

test("the live Partner Center option evidence rejects a non-object root", (t) => {
  const fixture = createFixture(t);
  const evidencePath = join(
    fixture,
    "docs/assets/microsoft-store/partner-center-language-options.json",
  );
  writeFileSync(evidencePath, "null\n", "utf8");

  const result = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "Partner Center live language options",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /schema/u);
});

test("native-reviewed status without provenance remains blocked", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales[0].reviewStatus = "native-reviewed";
  manifest.locales[0].nativeReview = null;
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreSubmissionReadiness(fixture).find(
    (candidate) => candidate.label === "native review approval",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /af-ZA/u);
});

test("submission readiness rejects an invalid reviewed timestamp", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.locales[0].reviewStatus = "native-reviewed";
  manifest.locales[0].nativeReview = {
    reviewer: "native-reviewer",
    reviewedAt: "not-a-timestamp",
    provenance: "review-record",
  };
  writeManifest(fixture, manifest);

  const result = checkMicrosoftStoreSubmissionReadiness(fixture).find(
    (candidate) => candidate.label === "native review approval",
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail ?? "", /af-ZA/u);
});

test("submission readiness lists af-ZA when screenshot reviewedAt is missing or invalid", (t) => {
  for (const reviewedAt of [undefined, "not-a-timestamp"]) {
    const fixture = createFixture(t);
    const entry = readManifest(fixture).locales[0];
    entry.listing.assets = {
      screenshotUrls: ["https://example.test/TEST-FIXTURE/af-ZA.png"],
      screenshotBinding: {
        status: "reviewed",
        reviewer: "native-reviewer",
        ...(reviewedAt === undefined ? {} : { reviewedAt }),
        provenance: "screenshot-record",
      },
    };
    const manifest = readManifest(fixture);
    manifest.locales[0] = entry;
    writeManifest(fixture, manifest);

    const result = checkMicrosoftStoreSubmissionReadiness(fixture).find(
      (candidate) => candidate.label === "screenshot binding",
    );
    assert.equal(result?.passed, false);
    assert.match(result?.detail ?? "", /af-ZA/u);
  }
});

test("submission readiness rejects an invalid HTTPS screenshot URL", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const entry = manifest.locales[0];
  entry.listing.assets.screenshotUrls = ["https://"];
  entry.listing.assets.screenshotBinding = {
    status: "reviewed",
    reviewer: "native-reviewer",
    provenance: "screenshot-record",
  };
  writeManifest(fixture, manifest);

  const draftResult = checkMicrosoftStoreLocalization(fixture).find(
    (candidate) => candidate.label === "asset binding model",
  );
  assert.equal(draftResult?.passed, false);
  const readinessResult = checkMicrosoftStoreSubmissionReadiness(fixture).find(
    (candidate) => candidate.label === "screenshot binding",
  );
  assert.equal(readinessResult?.passed, false);
  assert.match(readinessResult?.detail ?? "", /af-ZA/u);
});

test("the UI policy check rejects an unlisted app locale", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.appUiPolicy.supportedLocales.push("xx");
  writeManifest(fixture, manifest);

  assert.equal(
    checkMicrosoftStoreLocalization(fixture).find(
      (result) => result.label === "application UI policy alignment",
    )?.passed,
    false,
  );
});

test("the UI policy check rejects duplicate policy entries", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  manifest.appUiPolicy.supportedLocales.push("en");
  writeManifest(fixture, manifest);

  assert.equal(
    checkMicrosoftStoreLocalization(fixture).find(
      (result) => result.label === "application UI policy alignment",
    )?.passed,
    false,
  );
});

test("the UI mapping check rejects unknown app locale mappings", (t) => {
  const fixture = createFixture(t);
  const manifest = readManifest(fixture);
  const duplicate = manifest.locales.find((entry) => entry.locale === "ca-ES");
  duplicate.appUiLocale = "xx";
  duplicate.appUiSupported = true;
  writeManifest(fixture, manifest);

  assert.equal(
    checkMicrosoftStoreLocalization(fixture).find(
      (result) => result.label === "Store/UI support separation",
    )?.passed,
    false,
  );
});

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "joessh-store-localization-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(join(root, "docs/assets/microsoft-store"), { recursive: true });
  mkdirSync(join(root, "packages/i18n/src"), { recursive: true });
  cpSync(
    join(
      repositoryRoot,
      "docs/assets/microsoft-store/localization-manifest.json",
    ),
    join(root, "docs/assets/microsoft-store/localization-manifest.json"),
  );
  cpSync(
    join(
      repositoryRoot,
      "docs/assets/microsoft-store/partner-center-language-options.json",
    ),
    join(
      root,
      "docs/assets/microsoft-store/partner-center-language-options.json",
    ),
  );
  cpSync(
    join(repositoryRoot, "packages/i18n/src/index.ts"),
    join(root, "packages/i18n/src/index.ts"),
  );
  return root;
}

function readManifest(root) {
  return JSON.parse(
    readFileSync(
      join(root, "docs/assets/microsoft-store/localization-manifest.json"),
      "utf8",
    ),
  );
}

function writeManifest(root, manifest) {
  writeFileSync(
    join(root, "docs/assets/microsoft-store/localization-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function legacyKeywordFragment(value) {
  return value
    .replace(/[.,;:()[\]']/gu, "")
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .join(" ")
    .slice(0, 40)
    .trim();
}
