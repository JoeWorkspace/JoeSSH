import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = process.env.ATLASTERM_E2E_MOBILE_STATIC_HOST ?? '127.0.0.1';
const offlinePort = numberEnv('ATLASTERM_MOBILE_PORT', 8099);
const livePort = numberEnv('ATLASTERM_MOBILE_LIVE_PORT', 8101);
const mobileSyncPort = numberEnv('ATLASTERM_E2E_MOBILE_SYNC_PORT', 4111);
const mobileSyncUrl = process.env.ATLASTERM_E2E_MOBILE_SYNC_URL ?? `http://${host}:${mobileSyncPort}`;
const mobileSyncAuthToken = process.env.ATLASTERM_E2E_MOBILE_SYNC_AUTH_TOKEN ?? 'e2e-mobile-sync-token';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..', '..');
const mobileRoot = path.join(repoRoot, 'apps', 'mobile');
const requireFromMobile = createRequire(path.join(mobileRoot, 'package.json'));
const runRoot = path.join(tmpdir(), `joessh-e2e-mobile-web-${process.pid}`);
const offlineRoot = path.join(runRoot, 'offline');
const liveRoot = path.join(runRoot, 'live');
const servers = [];

try {
  await rm(runRoot, { force: true, recursive: true });
  await mkdir(runRoot, { recursive: true });

  await exportMobileWeb('offline', offlineRoot, {
    EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN: '',
    EXPO_PUBLIC_ATLASTERM_SYNC_URL: '',
  });
  await exportMobileWeb('live', liveRoot, {
    EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN: mobileSyncAuthToken,
    EXPO_PUBLIC_ATLASTERM_SYNC_URL: mobileSyncUrl,
  });

  servers.push(await serveStatic('offline', offlineRoot, offlinePort));
  servers.push(await serveStatic('live', liveRoot, livePort));

  console.log(
    `JoeSSH mobile static web ready: offline http://${host}:${offlinePort}, live http://${host}:${livePort}`,
  );
} catch (error) {
  console.error(error);
  await cleanup();
  process.exit(1);
}

process.on('SIGINT', () => {
  void closeAndExit(0);
});
process.on('SIGTERM', () => {
  void closeAndExit(0);
});

function numberEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer port.`);
  }

  return value;
}

async function exportMobileWeb(label, outputDir, overrides) {
  console.log(`Exporting JoeSSH mobile ${label} web bundle to ${outputDir}`);
  await rm(outputDir, { force: true, recursive: true });

  const expoCli = requireFromMobile.resolve('expo/bin/cli');
  const env = {
    ...process.env,
    BROWSER: 'none',
    CI: '1',
    EXPO_NO_LOG_BOX: '1',
    EXPO_NO_TELEMETRY: '1',
    ...overrides,
  };

  await run(process.execPath, [
    expoCli,
    'export',
    '--platform',
    'web',
    '--output-dir',
    outputDir,
    '--clear',
    '--no-minify',
    '--max-workers',
    '2',
  ], {
    cwd: mobileRoot,
    env,
  });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });
}

async function serveStatic(label, root, port) {
  const indexPath = path.join(root, 'index.html');
  await stat(indexPath);

  const server = createServer(async (request, response) => {
    try {
      await handleStaticRequest(root, request.url ?? '/', response);
    } catch (error) {
      console.error(`mobile ${label} static server failed`, error);
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Internal server error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      console.log(`JoeSSH mobile ${label} static server listening at http://${host}:${port}`);
      resolve();
    });
  });

  return server;
}

async function handleStaticRequest(root, requestUrl, response) {
  const url = new URL(requestUrl, `http://${host}`);
  let filePath = path.join(root, decodeURIComponent(url.pathname));

  if (!isInside(root, filePath)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  let fileStat = await maybeStat(filePath);

  if (fileStat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    fileStat = await maybeStat(filePath);
  }

  if (!fileStat?.isFile()) {
    filePath = path.join(root, 'index.html');
    fileStat = await stat(filePath);
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': fileStat.size,
    'Content-Type': contentType(filePath),
  });
  createReadStream(filePath).pipe(response);
}

async function maybeStat(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.ico': 'image/x-icon',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.txt': 'text/plain; charset=utf-8',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
    }[extension] ?? 'application/octet-stream'
  );
}

async function closeAndExit(code) {
  await cleanup();
  process.exit(code);
}

async function cleanup() {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
  await rm(runRoot, { force: true, recursive: true });
}
