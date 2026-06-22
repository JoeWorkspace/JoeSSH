import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const e2eRoot = fileURLToPath(new URL('..', import.meta.url));
const portEnvNames = [
  'ATLASTERM_WEB_PORT',
  'ATLASTERM_WEB_LIVE_PORT',
  'ATLASTERM_WEB_REAL_SYNC_PORT',
  'ATLASTERM_DESKTOP_PORT',
  'ATLASTERM_MOBILE_PORT',
  'ATLASTERM_MOBILE_LIVE_PORT',
  'ATLASTERM_E2E_ADMIN_SNAPSHOT_PORT',
  'ATLASTERM_E2E_REAL_SYNC_PORT',
  'ATLASTERM_E2E_MOBILE_SYNC_PORT',
];

const allocatedPorts = await allocatePorts(portEnvNames.length);
const env = { ...process.env };

portEnvNames.forEach((name, index) => {
  env[name] = String(allocatedPorts[index]);
});

delete env.EXPO_PUBLIC_ATLASTERM_SYNC_URL;
env.ATLASTERM_E2E_TEST_TIMEOUT_MS ??= '120000';

console.log(
  `Running Playwright with fresh JoeSSH ports: ${portEnvNames.map((name) => `${name}=${env[name]}`).join(', ')}`,
);

const child = spawn(process.execPath, [requireResolvePlaywrightCli(), 'test', ...process.argv.slice(2)], {
  cwd: e2eRoot,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

async function allocatePorts(count) {
  const ports = [];
  const seen = new Set();

  while (ports.length < count) {
    const port = await getEphemeralPort();

    if (!seen.has(port)) {
      seen.add(port);
      ports.push(port);
    }
  }

  return ports;
}

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local TCP port.'));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function requireResolvePlaywrightCli() {
  return fileURLToPath(new URL('../../../node_modules/@playwright/test/cli.js', import.meta.url));
}
