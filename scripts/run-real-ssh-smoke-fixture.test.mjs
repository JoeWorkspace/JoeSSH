import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./run-real-ssh-smoke-fixture.mjs", import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL("../package.json", import.meta.url));

test("fixture runner can wrap a release gate without replacing the dogfood smoke", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");

  assert.match(source, /parseWrappedCommand\(process\.argv\.slice\(2\)\)/);
  assert.match(source, /runSmoke\(fixture\)/);
  assert.match(source, /if \(exitCode === 0 && wrappedCommand\)/);
  assert.match(source, /runFixtureCommand\(fixture, wrappedCommand\)/);
  assert.match(source, /qa:desktop:real-ssh-smoke:required/);
  assert.match(source, /wrappedCommand/);
  assert.match(source, /status: result\.status === 0 \? "passed" : "failed"/);
});

test("package exposes a fixture-backed public release gate", () => {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));

  assert.equal(
    packageJson.scripts["qa:release:public:fixture"],
    "node scripts/run-real-ssh-smoke-fixture.mjs -- npm run qa:release:public",
  );
});
