import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertArtifactPath,
  ensureArtifactDirectory,
  writeArtifactFile,
} from "./release-artifact-paths.mjs";

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "joessh-artifact-path-"));
  const root = join(base, "checkout");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, "sentinel.txt"), "unchanged");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, root, outside };
}

test("artifact output supports a normal worktree and safe file regeneration", (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, ".git"), "gitdir: synthetic-worktree-metadata\n");
  const path = join(root, "reports", "release", "artifact.txt");
  assert.equal(assertArtifactPath(root, path), path);
  assert.equal(existsSync(join(root, "reports")), false);
  writeArtifactFile(root, path, "first");
  writeArtifactFile(root, path, "second");
  assert.equal(readFileSync(path, "utf8"), "second");
});

test("artifact output rejects a lexical sibling without creating it", (t) => {
  const { root, outside } = fixture(t);
  assert.throws(
    () => writeArtifactFile(root, join(outside, "new.txt"), "bad"),
    /must stay below its checkout/,
  );
  assert.equal(existsSync(join(outside, "new.txt")), false);
});

for (const linkedAncestor of ["reports", "reports/release"]) {
  test(`artifact output rejects the ${linkedAncestor} ancestor junction before writes`, (t) => {
    const { root, outside } = fixture(t);
    if (linkedAncestor.includes("/")) mkdirSync(join(root, "reports"));
    symlinkSync(outside, join(root, linkedAncestor), "junction");
    assert.throws(
      () =>
        writeArtifactFile(
          root,
          join(root, linkedAncestor, "sentinel.txt"),
          "bad",
        ),
      /symbolic link or junction/,
    );
    assert.throws(
      () => ensureArtifactDirectory(root, join(root, linkedAncestor, "new")),
      /symbolic link or junction/,
    );
    assert.equal(
      readFileSync(join(outside, "sentinel.txt"), "utf8"),
      "unchanged",
    );
    assert.equal(existsSync(join(outside, "new")), false);
  });
}

test("artifact output rejects links within the checkout too", (t) => {
  const { root } = fixture(t);
  mkdirSync(join(root, "actual"));
  symlinkSync(join(root, "actual"), join(root, "reports"), "junction");
  assert.throws(
    () => writeArtifactFile(root, join(root, "reports", "new.txt"), "bad"),
    /symbolic link or junction/,
  );
  assert.equal(existsSync(join(root, "actual", "new.txt")), false);
});

test("artifact output anchors an explicitly selected root alias at its real checkout", (t) => {
  const { base, root } = fixture(t);
  const alias = join(base, "root-alias");
  symlinkSync(root, alias, "junction");
  writeArtifactFile(alias, join(alias, "reports", "new.txt"), "good");
  assert.equal(readFileSync(join(root, "reports", "new.txt"), "utf8"), "good");
});

test("artifact output refuses existing hard links without modifying their target", (t) => {
  const { root, outside } = fixture(t);
  const path = join(root, "artifact.txt");
  linkSync(join(outside, "sentinel.txt"), path);
  assert.throws(() => writeArtifactFile(root, path, "bad"), /hard links/);
  assert.equal(
    readFileSync(join(outside, "sentinel.txt"), "utf8"),
    "unchanged",
  );
});

for (const dangling of [false, true]) {
  test(`artifact output refuses a ${dangling ? "dangling" : "regular"} file symlink`, (t) => {
    const { root, outside } = fixture(t);
    const path = join(root, "artifact.txt");
    const target = join(outside, dangling ? "missing.txt" : "sentinel.txt");
    try {
      symlinkSync(target, path, "file");
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES") {
        t.skip("File symlinks are unavailable on this test host.");
        return;
      }
      throw error;
    }
    assert.throws(() => writeArtifactFile(root, path, "bad"), /symbolic link/);
    assert.equal(
      readFileSync(join(outside, "sentinel.txt"), "utf8"),
      "unchanged",
    );
    if (dangling) assert.equal(existsSync(target), false);
  });
}

test("artifact output refuses a non-directory ancestor and a directory file target", (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, "reports"), "unchanged");
  assert.throws(
    () => writeArtifactFile(root, join(root, "reports", "new.txt"), "bad"),
    /regular directory/,
  );
  mkdirSync(join(root, "directory"));
  assert.throws(
    () => writeArtifactFile(root, join(root, "directory"), "bad"),
    /regular file/,
  );
  assert.equal(readFileSync(join(root, "reports"), "utf8"), "unchanged");
});

test("artifact output revalidates a path whose ancestor changed after the first check", (t) => {
  const { root, outside } = fixture(t);
  const path = join(root, "reports", "sentinel.txt");
  assertArtifactPath(root, path);
  symlinkSync(outside, join(root, "reports"), "junction");
  assert.throws(() => writeArtifactFile(root, path, "bad"), /junction/);
  assert.equal(
    readFileSync(join(outside, "sentinel.txt"), "utf8"),
    "unchanged",
  );
});
