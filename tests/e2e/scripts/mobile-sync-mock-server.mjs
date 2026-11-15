import http from 'node:http';

const host = process.env.ATLASTERM_E2E_MOBILE_SYNC_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.ATLASTERM_E2E_MOBILE_SYNC_PORT ?? '4111', 10);
const expectedToken = process.env.ATLASTERM_E2E_MOBILE_SYNC_AUTH_TOKEN ?? 'e2e-mobile-sync-token';

let pushCount = 0;
let pullCount = 0;

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;

  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'accept, authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '60',
    });
    response.end();
    return;
  }

  if (request.url === '/healthz') {
    sendJson(response, 200, { ok: true, service: 'atlasterm-mobile-sync-e2e' });
    return;
  }

  if (!request.url?.startsWith('/v1/')) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  if (request.headers.authorization !== `Bearer ${expectedToken}`) {
    sendJson(response, 401, { code: 'invalid_authorization' });
    return;
  }

  if (request.method === 'POST' && request.url === '/v1/devices/register') {
    await readJsonBody(request);
    sendJson(response, 200, {
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      server_time: '2026-05-25T00:00:00Z',
      sync_cursor: '0',
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/v1/sync/push') {
    await readJsonBody(request);
    pushCount += 1;
    sendJson(response, 202, {
      accepted: 1,
      conflicts: [],
      sync_cursor: pushCount === 1 ? 'server-41' : 'server-43',
    });
    return;
  }

  if (request.method === 'GET' && request.url.startsWith('/v1/sync/pull?')) {
    pullCount += 1;
    const changes =
      pullCount === 1
        ? [
            syncChange('00000000-0000-4000-8000-000000000001', 'profile', 'prod-edge-01', 'create', 'server-40'),
            syncChange('00000000-0000-4000-8000-000000000002', 'profile', 'prod-edge-02', 'create', 'server-41'),
            syncChange('00000000-0000-4000-8000-000000000003', 'session', 'session-01', 'create', 'server-42'),
          ]
        : [
            syncChange('00000000-0000-4000-8000-000000000004', 'profile', 'prod-edge-02', 'delete', 'server-43'),
            syncChange('00000000-0000-4000-8000-000000000005', 'profile', 'prod-edge-03', 'create', 'server-43'),
          ];
    sendJson(response, 200, {
      changes,
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      has_more: false,
      next_cursor: pullCount === 1 ? 'server-42' : 'server-43',
    });
    return;
  }

  sendJson(response, 404, { error: 'not_found' });
});

server.listen(port, host, () => {
  console.log(`JoeSSH mobile sync mock listening at http://${host}:${port}`);
});

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

function syncChange(id, entityType, entityId, operation, cursor) {
  return {
    entity_id: entityId,
    entity_type: entityType,
    id,
    operation,
    payload: {},
    server_time: '2026-05-25T00:00:00Z',
    sync_cursor: cursor,
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      if (!raw) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function close() {
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
