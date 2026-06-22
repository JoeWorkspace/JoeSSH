import { basename } from "node:path";

const requiredEnv = [
  "JOESSH_REAL_SSH_SMOKE",
  "JOESSH_REAL_SSH_HOST",
  "JOESSH_REAL_SSH_PORT",
  "JOESSH_REAL_SSH_USERNAME",
  "JOESSH_REAL_SSH_REMOTE_DIR",
];
const credentialEnv = [
  "JOESSH_REAL_SSH_PASSWORD",
  "JOESSH_REAL_SSH_PRIVATE_KEY_PEM",
  "JOESSH_REAL_SSH_PRIVATE_KEY_PATH",
];

const missing = requiredEnv.filter((name) => !process.env[name]?.trim());
const errors = [];

if (missing.length > 0) {
  errors.push(`Missing real SSH smoke environment variable(s): ${missing.join(", ")}`);
}

if (process.env.JOESSH_REAL_SSH_SMOKE?.trim() && process.env.JOESSH_REAL_SSH_SMOKE.trim() !== "1") {
  errors.push("JOESSH_REAL_SSH_SMOKE must be set to 1 for Public Beta release dogfood.");
}

const configuredCredentialEnv = credentialEnv.filter((name) => process.env[name]?.trim());
if (configuredCredentialEnv.length === 0) {
  errors.push(`Set exactly one real SSH credential variable: ${credentialEnv.join(", ")}`);
}
if (configuredCredentialEnv.length > 1) {
  errors.push(`Set only one real SSH credential variable; found: ${configuredCredentialEnv.join(", ")}`);
}

const port = process.env.JOESSH_REAL_SSH_PORT?.trim();
if (port && !isValidPort(port)) {
  errors.push("JOESSH_REAL_SSH_PORT must be an integer from 1 to 65535.");
}

if (errors.length > 0) {
  console.error(`${basename(import.meta.url)}: ${errors.join("\n")}`);
  process.exit(1);
}

console.log("Verified real SSH smoke fixture environment.");

function isValidPort(value) {
  if (!/^[0-9]+$/.test(value)) {
    return false;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
}
