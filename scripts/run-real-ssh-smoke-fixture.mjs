import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const sshdCommand = process.env.JOESSH_REAL_SSH_FIXTURE_SSHD ?? findCommand("sshd");
const sshKeygenCommand = process.env.JOESSH_REAL_SSH_FIXTURE_SSH_KEYGEN ?? findCommand("ssh-keygen");
const sftpServerCommand = process.env.JOESSH_REAL_SSH_FIXTURE_SFTP_SERVER ?? findCommand("sftp-server");
const outputPath = resolve(root, "reports", "smoke", "desktop", "real-ssh-smoke.json");
const checksumPath = resolve(root, "reports", "smoke", "desktop", "real-ssh-smoke-SHA256SUMS.txt");

if (process.platform !== "win32") {
  fail("The local OpenSSH fixture runner currently supports Windows release machines. Use the CI loopback OpenSSH fixture on Linux.");
}

if (!sshdCommand || !sshKeygenCommand || !sftpServerCommand) {
  fail("OpenSSH sshd, ssh-keygen, and sftp-server must be available to run the local real SSH smoke fixture.");
}

const startedAt = new Date();
const tempRoot = mkdtempSync(join(tmpdir(), "joessh-real-ssh-"));
let sshd = null;
let exitCode = 1;
let errorMessage = null;

try {
  hardenWindowsAcl(tempRoot, "(OI)(CI)(F)");
  const fixture = prepareFixture(tempRoot);
  sshd = startSshd(fixture);
  await waitForPort(fixture.port);
  const result = runSmoke(fixture);
  exitCode = result.status ?? 1;
  writeEvidence(fixture, startedAt, new Date(), result);
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
  writeEvidence(null, startedAt, new Date(), {
    status: 1,
    stdout: "",
    stderr: errorMessage,
  });
} finally {
  await stopSshd(sshd);
  cleanupTempRoot(tempRoot);
}

if (errorMessage) {
  fail(errorMessage);
}

process.exit(exitCode);

function prepareFixture(directory) {
  const hostKey = join(directory, "ssh_host_ed25519_key");
  const userKey = join(directory, "id_ed25519");
  const authorizedKeys = join(directory, "authorized_keys");
  const sshdConfig = join(directory, "sshd_config");
  const stdoutLog = join(directory, "sshd.out.log");
  const stderrLog = join(directory, "sshd.err.log");
  const port = findOpenPort();

  runChecked(sshKeygenCommand, ["-q", "-t", "ed25519", "-N", "", "-f", hostKey, "-C", "joessh-fixture-host"]);
  runChecked(sshKeygenCommand, ["-q", "-t", "ed25519", "-N", "", "-f", userKey, "-C", "joessh-fixture-user"]);
  copyFileSync(`${userKey}.pub`, authorizedKeys);
  hardenWindowsAcl(authorizedKeys, "R");
  hardenWindowsAcl(userKey, "R");

  writeFileSync(
    sshdConfig,
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${toSshPath(hostKey)}`,
      `AuthorizedKeysFile ${toSshPath(authorizedKeys)}`,
      `PidFile ${toSshPath(join(directory, "sshd.pid"))}`,
      "PasswordAuthentication no",
      "PubkeyAuthentication yes",
      "PermitTTY yes",
      "AllowTcpForwarding yes",
      "PermitOpen any",
      `Subsystem sftp ${toSshPath(sftpServerCommand)}`,
      "LogLevel VERBOSE",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    authorizedKeys,
    directory,
    hostKey,
    port,
    sshdConfig,
    stderrLog,
    stdoutLog,
    userKey,
  };
}

function startSshd(fixture) {
  const out = writeFileSync(fixture.stdoutLog, "");
  const err = writeFileSync(fixture.stderrLog, "");
  void out;
  void err;

  const child = spawn(sshdCommand, ["-D", "-e", "-f", fixture.sshdConfig], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(chunk);
    writeFileSync(fixture.stdoutLog, Buffer.concat(stdoutChunks));
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
    writeFileSync(fixture.stderrLog, Buffer.concat(stderrChunks));
  });
  return child;
}

function runSmoke(fixture) {
  const env = {
    ...process.env,
    JOESSH_REAL_SSH_SMOKE: "1",
    JOESSH_REAL_SSH_HOST: "127.0.0.1",
    JOESSH_REAL_SSH_PORT: String(fixture.port),
    JOESSH_REAL_SSH_USERNAME: process.env.USERNAME ?? process.env.USER ?? "",
    JOESSH_REAL_SSH_PRIVATE_KEY_PATH: fixture.userKey,
    JOESSH_REAL_SSH_REMOTE_DIR: toSshPath(fixture.directory),
    JOESSH_REAL_SSH_EXEC_COMMAND: "powershell -NoProfile -Command \"[Console]::Write('joessh-exec-ok')\"",
    JOESSH_REAL_SSH_EXEC_EXPECTED: "joessh-exec-ok",
    JOESSH_REAL_SSH_PTY_COMMAND: "echo joessh-pty-ok\\nexit\\n",
    JOESSH_REAL_SSH_PTY_EXPECTED: "joessh-pty-ok",
  };
  delete env.JOESSH_REAL_SSH_PASSWORD;
  delete env.JOESSH_REAL_SSH_PRIVATE_KEY_PEM;

  return spawnSync(npmCommand, ["run", "qa:desktop:real-ssh-smoke:required"], {
    cwd: root,
    encoding: "utf8",
    env,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeEvidence(fixture, started, finished, result) {
  const evidence = {
    auth: "private-key",
    checks: [
      "host-key probe",
      "pinned host-key authentication",
      "exec marker",
      "SFTP list/download/upload/overwrite",
      "PTY marker",
      "local forwarding start/traffic/shutdown",
    ],
    fixture: "local-openssh",
    finishedAt: finished.toISOString(),
    platform: process.platform,
    port: fixture?.port ?? null,
    startedAt: started.toISOString(),
    status: result.status === 0 ? "passed" : "failed",
    stderrTail: tail(result.error ? `${result.stderr ?? ""}\n${result.error.message}` : (result.stderr ?? "")),
    stdoutTail: tail(result.stdout ?? ""),
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(checksumPath, `${sha256(outputPath)}  ${toReleasePath(outputPath)}\n`);

  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  console.log(`Wrote ${toReleasePath(outputPath)}`);
  console.log(`Wrote ${toReleasePath(checksumPath)}`);
}

function hardenWindowsAcl(path, rights) {
  const user = runChecked("whoami", []).stdout.trim();
  runChecked("icacls", [
    path,
    "/inheritance:r",
    "/remove:g",
    "NT AUTHORITY\\Authenticated Users",
    "BUILTIN\\Users",
    "/grant:r",
    `${user}:${rights}`,
    "SYSTEM:F",
    "Administrators:F",
  ]);
}

function cleanupTempRoot(path) {
  try {
    const user = runChecked("whoami", []).stdout.trim();
    spawnSync("icacls", [path, "/grant:r", `${user}:F`, `${user}:(OI)(CI)(F)`, "/T", "/C"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // Best effort: cleanup should not hide the real smoke result.
  }
  rmSync(path, { recursive: true, force: true });
}

function stopSshd(child) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolvePromise();
    }, 2_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    child.kill("SIGTERM");
  });
}

function runChecked(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(diagnostic ? `${command} failed: ${diagnostic}` : `${command} failed`);
  }
  return result;
}

function findOpenPort() {
  const script = [
    "const net=require('node:net');",
    "const server=net.createServer();",
    "server.listen(0,'127.0.0.1',()=>{console.log(server.address().port);server.close();});",
  ].join("");
  const result = runChecked(process.execPath, ["-e", script]);
  return Number(result.stdout.trim());
}

function waitForPort(port) {
  const deadline = Date.now() + 10_000;
  return new Promise((resolvePromise, rejectPromise) => {
    const tryConnect = () => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          rejectPromise(new Error(`Timed out waiting for OpenSSH fixture on port ${port}.`));
          return;
        }
        setTimeout(tryConnect, 100);
      });
    };
    tryConnect();
  });
}

function findCommand(name) {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, [name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.split(/\r?\n/).find((line) => line.trim())?.trim() : null;
}

function toSshPath(path) {
  return path.replace(/\\/g, "/");
}

function toReleasePath(path) {
  return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, "/") : path.replace(/\\/g, "/");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function tail(value) {
  const lines = value.split(/\r?\n/).filter(Boolean);
  return lines.slice(-40);
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
