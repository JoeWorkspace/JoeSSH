import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  ZOD_REGISTRATION,
  verifyVendoredZod,
} from "./vendored-zod-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const verified = verifyVendoredZod(root);
const require = createRequire(import.meta.url);
const probe = join(root, "scripts/vendored-zod-security-probe.mjs");
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "joessh-zod-security-"));
  t.after(() => {
    assert.equal(dirname(directory), tmpdir());
    assert(directory.includes("joessh-zod-security-"));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function runProbe(entry, kind) {
  const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=96", probe, entry, kind],
    {
      encoding: "utf8",
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function originalControl(t) {
  const directory = join(temporary(t), "original-v3");
  cpSync(verified.directory, directory, { recursive: true });
  for (const file of ["src/v3/types.ts", "v3/types.js", "v3/types.cjs"]) {
    const target = join(directory, file),
      symbol = file.endsWith(".cjs") ? "parseUtil_js_1.INVALID" : "INVALID";
    let text = readFileSync(target, "utf8");
    const line = new RegExp(
      "^[ \\t]*if \\(tooBig\\) return " +
        symbol.replaceAll(".", "\\.") +
        ";\\r?\\n",
      "m",
    );
    assert(line.test(text));
    text = text.replace(line, "");
    for (const marker of [
      "if (def.maxLength !== null)",
      "if (def.maxSize !== null)",
    ]) {
      const start = text.indexOf(marker),
        end = text.indexOf("return " + symbol + ";", start);
      assert(start > 0 && end > start);
      text =
        text.slice(0, end) +
        "status.dirty();" +
        text.slice(end + ("return " + symbol + ";").length);
    }
    assert.equal(
      hash(Buffer.from(text)),
      verified.metadata.originalFiles[file].sha256,
      "Negative control must match the exact published original bytes.",
    );
    writeFileSync(target, text);
  }
  writeFileSync(
    join(directory, "package.json"),
    readFileSync(join(directory, "package.original.json")),
  );
  return directory;
}

test("bounded published-byte negative controls distinguish both patched CJS and ESM runtimes", (t) => {
  const original = originalControl(t);
  for (const extension of ["cjs", "js"]) {
    const before = runProbe(join(original, "index." + extension), "original");
    const after = runProbe(
      join(verified.directory, "index." + extension),
      "patched",
    );
    assert.equal(before.observations.length, 19);
    assert.equal(after.observations.length, 19);
    assert.deepEqual(
      after.controls,
      before.controls,
      "Valid, minimum-size, wrong-type, preprocessing and unbounded behavior must remain unchanged.",
    );
    assert(
      before.observations.slice(0, 16).every((item) => item.children === 32),
    );
    assert(after.observations.every((item) => item.children === 0));
    t.diagnostic(
      extension +
        ": 32-element sync/async array.max/length and set.max/size input: child walks 32 -> 0; invalid-element issues 33 -> 1; no OOM attempted.",
    );
  }
});

test("real Expo CLI schemas consume the installed v3 backport offline", () => {
  const cliRoot = join(root, ZOD_REGISTRATION.consumerPath);
  const cliRequire = createRequire(join(cliRoot, "package.json"));
  assert.equal(
    realpathSync(cliRequire.resolve("zod")),
    realpathSync(join(verified.directory, "index.cjs")),
  );
  assert.equal(
    realpathSync(cliRequire.resolve("zod/v3")),
    realpathSync(join(verified.directory, "v3/index.cjs")),
  );
  const zod = cliRequire("zod"),
    subpath = cliRequire("zod/v3");
  assert.equal(zod.ZodType, subpath.ZodType);
  assert.equal(
    typeof zod.z.map(zod.z.string(), zod.z.string()).max,
    "undefined",
    "No incompatible v4 map API is introduced.",
  );
  const schemas = cliRequire(
    join(cliRoot, "build/src/start/server/DevToolsPlugin.schema.js"),
  );
  assert(schemas.PluginSchema instanceof zod.ZodType);
  const plugin = schemas.PluginSchema.parse({
    packageName: "synthetic-plugin",
    packageRoot: "./synthetic",
    cliExtensions: {
      description: "Synthetic test",
      entryPoint: "./synthetic.js",
      commands: [
        {
          name: "echo",
          title: "Synthetic echo",
          environments: ["cli", "mcp"],
          parameters: [
            { name: "message", type: "text", description: "Synthetic input" },
          ],
        },
      ],
    },
  });
  assert.equal(
    schemas.PluginSchema.safeParse({
      packageName: "",
      packageRoot: "./synthetic",
    }).success,
    false,
  );
  assert.equal(
    schemas.DevToolsPluginOutputSchema.safeParse([
      { type: "text", text: "synthetic output", level: "info" },
    ]).success,
    true,
  );
  assert.equal(
    schemas.DevToolsPluginOutputSchema.safeParse([
      { type: "text", text: 1, level: "info" },
    ]).success,
    false,
  );
  const { createMCPDevToolsExtensionSchema } = cliRequire(
    join(cliRoot, "build/src/start/server/createMCPDevToolsExtensionSchema.js"),
  );
  const command = createMCPDevToolsExtensionSchema(plugin);
  assert.deepEqual(command.parse({ command: "echo", message: "synthetic" }), {
    command: "echo",
    message: "synthetic",
  });
  assert.equal(
    command.safeParse({ command: "echo", message: 1 }).success,
    false,
  );
  assert.equal(command.safeParse({ command: "unknown" }).success, false);
  assert.equal(
    command.safeParse({ command: "echo", unexpected: true }).success,
    false,
  );
  assert.notEqual(
    realpathSync(require.resolve("zod/package.json")),
    realpathSync(join(verified.directory, "package.json")),
    "Root v4 remains separate.",
  );
  assert.equal(
    JSON.parse(readFileSync(require.resolve("zod/package.json"), "utf8"))
      .version,
    "4.6.7",
  );
  for (const key of verified.metadata.distribution.removedExports)
    assert.throws(() => cliRequire.resolve("zod" + key.slice(1)), {
      code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
});

test("the real Expo CLI entry starts offline with an isolated empty user directory", (t) => {
  const directory = temporary(t),
    cli = require.resolve("@expo/cli");
  for (const name of ["appdata", "localappdata", "temp"])
    mkdirSync(join(directory, name));
  const env = {
    CI: "1",
    EXPO_OFFLINE: "1",
    EXPO_NO_TELEMETRY: "1",
    EXPO_NO_DOTENV: "1",
    HOME: directory,
    USERPROFILE: directory,
    APPDATA: join(directory, "appdata"),
    LOCALAPPDATA: join(directory, "localappdata"),
    TEMP: join(directory, "temp"),
    TMP: join(directory, "temp"),
  };
  for (const name of [
    "SystemRoot",
    "WINDIR",
    "PATH",
    "Path",
    "PATHEXT",
    "ComSpec",
  ])
    if (process.env[name]) env[name] = process.env[name];
  const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=128", cli, "--version"],
    {
      cwd: directory,
      env,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    JSON.parse(
      readFileSync(
        join(root, ZOD_REGISTRATION.consumerPath, "package.json"),
        "utf8",
      ),
    ).version,
  );
});

test("NodeNext TypeScript consumers retain v3 inference through both supported entries", (t) => {
  const directory = temporary(t);
  mkdirSync(join(directory, "node_modules"));
  symlinkSync(
    verified.directory,
    join(directory, "node_modules/zod"),
    process.platform === "win32" ? "junction" : "dir",
  );
  writeFileSync(join(directory, "package.json"), '{"type":"module"}\n');
  const source =
    'import { z } from "zod";\nimport * as v3 from "zod/v3";\nconst schema = z.object({ name: z.string(), count: z.number().optional(), tags: z.array(z.string()).max(2) });\ntype Value = z.infer<typeof schema>;\nconst value: Value = { name: "synthetic", tags: ["one"] };\nconst parsed: Value = schema.parse(value);\nconst set: Set<string> = v3.set(v3.string()).max(2).parse(new Set(["one"]));\nvoid parsed; void set;\n// @ts-expect-error Original v3 inference rejects a number name.\nconst wrong: Value = { name: 1, tags: [] };\nvoid wrong;\n';
  const file = join(directory, "consumer.ts");
  writeFileSync(file, source);
  const compiler = require.resolve("typescript/bin/tsc");
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=256",
      compiler,
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      file,
    ],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
