import assert from "node:assert/strict";
import test from "node:test";

import { collectRunWarningFailures } from "./lighthouse-audit.mjs";

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
