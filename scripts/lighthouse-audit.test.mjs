import assert from "node:assert/strict";
import test from "node:test";

import {
  collectRunWarningFailures,
  collectThresholdFailures,
} from "./lighthouse-audit.mjs";

test("Lighthouse run warnings fail closed", () => {
  assert.deepEqual(
    collectRunWarningFailures({
      runWarnings: ["The page may not have loaded completely."],
    }),
    ["Lighthouse run warning: The page may not have loaded completely."],
  );
});

test("Lighthouse run warning checks ignore empty warning entries", () => {
  assert.deepEqual(
    collectRunWarningFailures({
      runWarnings: ["", "   ", null],
    }),
    [],
  );
});

test("Lighthouse run warning checks tolerate missing warning arrays", () => {
  assert.deepEqual(collectRunWarningFailures({}), []);
  assert.deepEqual(collectRunWarningFailures(null), []);
});

test("Lighthouse threshold checks report below-minimum categories", () => {
  assert.deepEqual(
    collectThresholdFailures(
      {
        categories: {
          accessibility: { score: 1, title: "Accessibility" },
          "best-practices": { score: 1, title: "Best Practices" },
          performance: { score: 0.88, title: "Performance" },
          seo: { score: 1, title: "SEO" },
        },
      },
      {
        accessibility: 0.9,
        "best-practices": 0.9,
        performance: 0.9,
        seo: 0.9,
      },
    ),
    ["Performance scored 88/100 below minimum 90/100"],
  );
});

test("Lighthouse threshold checks pass when all categories meet the gate", () => {
  assert.deepEqual(
    collectThresholdFailures(
      {
        categories: {
          accessibility: { score: 0.9, title: "Accessibility" },
          "best-practices": { score: 0.95, title: "Best Practices" },
          performance: { score: 0.91, title: "Performance" },
          seo: { score: 1, title: "SEO" },
        },
      },
      {
        accessibility: 0.9,
        "best-practices": 0.9,
        performance: 0.9,
        seo: 0.9,
      },
    ),
    [],
  );
});

test("Lighthouse threshold checks fail closed on missing category scores", () => {
  assert.deepEqual(
    collectThresholdFailures(
      {
        categories: {
          accessibility: { score: 1, title: "Accessibility" },
          "best-practices": { score: 1, title: "Best Practices" },
          performance: { title: "Performance" },
          seo: { score: 1, title: "SEO" },
        },
      },
      {
        accessibility: 0.9,
        "best-practices": 0.9,
        performance: 0.9,
        seo: 0.9,
      },
    ),
    ["performance score is missing"],
  );
});
