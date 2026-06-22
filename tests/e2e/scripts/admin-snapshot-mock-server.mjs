import http from 'node:http';

const host = process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_PORT ?? '4110', 10);
const expectedToken = process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_AUTH_TOKEN ?? 'e2e-admin-snapshot-token';

const snapshot = {
  auditEvents: [
    {
      action: 'Accepted Update sync change',
      actor: 'JoeSSH Sync',
      id: 'audit-sync-api-change',
      target: 'mobile_presence',
      time: '10:42',
    },
  ],
  devices: [
    {
      cursor: 'server-4100',
      id: 'sync-api-desktop',
      lastSeen: 'Live',
      name: 'Sync API Desktop',
      owner: 'Local Sync Operator',
      platform: 'desktop',
      status: 'current',
    },
    {
      cursor: 'server-4098',
      id: 'sync-api-mobile',
      lastSeen: '4 min ago',
      name: 'Sync API Mobile',
      owner: 'Local Sync Operator',
      platform: 'ios',
      status: 'catching_up',
    },
  ],
  members: [
    {
      deviceCount: 2,
      email: 'local-sync@atlasterm.dev',
      id: 'member-local-sync',
      name: 'Local Sync Operator',
      role: 'Workspace Admin',
      status: 'active',
    },
  ],
  metrics: {
    activeMembers: 1,
    auditEventsToday: 1,
    healthyDevices: 1,
    rolesConfigured: 1,
  },
  roles: [
    {
      id: 'workspace-admin',
      memberCount: 1,
      name: 'Workspace Admin',
      risk: 'full',
      scope: 'Members, roles, sync policy',
    },
  ],
};

const server = http.createServer((request, response) => {
  const origin = request.headers.origin;

  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'accept, authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '60',
    });
    response.end();
    return;
  }

  if (request.url === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'atlasterm-admin-snapshot-e2e' }));
    return;
  }

  if (request.url !== '/v1/admin/snapshot') {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  if (request.headers.authorization !== `Bearer ${expectedToken}`) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 'invalid_authorization' }));
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(snapshot));
});

server.listen(port, host, () => {
  console.log(`JoeSSH admin snapshot mock listening at http://${host}:${port}`);
});

function close() {
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
