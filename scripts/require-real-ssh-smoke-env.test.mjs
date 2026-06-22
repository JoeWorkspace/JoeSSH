import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./require-real-ssh-smoke-env.mjs", import.meta.url));
const REQUIRED_ENV = [
  "JOESSH_REAL_SSH_SMOKE",
  "JOESSH_REAL_SSH_HOST",
  "JOESSH_REAL_SSH_PORT",
  "JOESSH_REAL_SSH_USERNAME",
  "JOESSH_REAL_SSH_PASSWORD",
  "JOESSH_REAL_SSH_PRIVATE_KEY_PEM",
  "JOESSH_REAL_SSH_PRIVATE_KEY_PATH",
  "JOESSH_REAL_SSH_PRIVATE_KEY_PASSPHRASE",
  "JOESSH_REAL_SSH_REMOTE_DIR",
];

function cleanEnv() {
  const env = { ...process.env };
  for (const name of REQUIRED_ENV) {
    delete env[name];
  }
  return env;
}

function runGuard(env) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    encoding: "utf8",
    env,
  });
}

test("fails when the real SSH fixture environment is missing", () => {
  const result = runGuard(cleanEnv());

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing real SSH smoke environment variable\(s\)/);
  assert.match(result.stderr, /JOESSH_REAL_SSH_HOST/);
  assert.match(result.stderr, /Set exactly one real SSH credential variable/);
});

test("rejects disabled smoke and invalid ports without printing secret values", () => {
  const result = runGuard({
    ...cleanEnv(),
    JOESSH_REAL_SSH_SMOKE: "0",
    JOESSH_REAL_SSH_HOST: "127.0.0.1",
    JOESSH_REAL_SSH_PORT: "70000",
    JOESSH_REAL_SSH_USERNAME: "smoke-user",
    JOESSH_REAL_SSH_PASSWORD: "super-secret-password",
    JOESSH_REAL_SSH_REMOTE_DIR: "/tmp",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /JOESSH_REAL_SSH_SMOKE must be set to 1/);
  assert.match(result.stderr, /JOESSH_REAL_SSH_PORT must be an integer/);
  assert.doesNotMatch(result.stderr, /super-secret-password/);
});

test("rejects ambiguous credential inputs without printing secret values", () => {
  const result = runGuard({
    ...cleanEnv(),
    JOESSH_REAL_SSH_SMOKE: "1",
    JOESSH_REAL_SSH_HOST: "127.0.0.1",
    JOESSH_REAL_SSH_PORT: "2222",
    JOESSH_REAL_SSH_USERNAME: "smoke-user",
    JOESSH_REAL_SSH_PASSWORD: "super-secret-password",
    JOESSH_REAL_SSH_PRIVATE_KEY_PEM: "-----BEGIN OPENSSH PRIVATE KEY----- secret -----END OPENSSH PRIVATE KEY-----",
    JOESSH_REAL_SSH_REMOTE_DIR: "/tmp",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set only one real SSH credential variable/);
  assert.doesNotMatch(result.stderr, /super-secret-password/);
  assert.doesNotMatch(result.stderr, /BEGIN OPENSSH PRIVATE KEY/);
});

test("passes when the real SSH fixture environment has password auth", () => {
  const result = runGuard({
    ...cleanEnv(),
    JOESSH_REAL_SSH_SMOKE: "1",
    JOESSH_REAL_SSH_HOST: "127.0.0.1",
    JOESSH_REAL_SSH_PORT: "2222",
    JOESSH_REAL_SSH_USERNAME: "smoke-user",
    JOESSH_REAL_SSH_PASSWORD: "super-secret-password",
    JOESSH_REAL_SSH_REMOTE_DIR: "/tmp",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Verified real SSH smoke fixture environment/);
  assert.doesNotMatch(result.stdout, /super-secret-password/);
});

test("passes when the real SSH fixture environment has private key auth", () => {
  const result = runGuard({
    ...cleanEnv(),
    JOESSH_REAL_SSH_SMOKE: "1",
    JOESSH_REAL_SSH_HOST: "127.0.0.1",
    JOESSH_REAL_SSH_PORT: "2222",
    JOESSH_REAL_SSH_USERNAME: "smoke-user",
    JOESSH_REAL_SSH_PRIVATE_KEY_PATH: "/tmp/joessh-smoke-key",
    JOESSH_REAL_SSH_REMOTE_DIR: "/tmp",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Verified real SSH smoke fixture environment/);
});
