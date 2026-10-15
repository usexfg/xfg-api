// The public audit route is the one accounting endpoint an auditor must be able
// to read without credentials, and the one whose numbers must survive the JSON
// round trip exactly. This covers both: no API key required, and every monetary
// value still a quoted decimal string when it reaches the client.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

// The audit route reads nothing from the candle store, but server.js opens
// better-sqlite3 at require time. Its prebuilt native module segfaults on some
// Node builds, which would take the whole gateway down before any route runs.
// Stub it so this test exercises the routing and the response, not SQLite.
function stubSqlite() {
  const stub = class FakeDatabase {
    pragma() { return this; }
    exec() { return this; }
    prepare() { return { run() {}, get() {}, all() { return []; } }; }
    transaction(fn) { return () => {}; }
  };
  const resolved = require.resolve('better-sqlite3');
  require.cache[resolved] = new Module(resolved, null);
  require.cache[resolved].filename = resolved;
  require.cache[resolved].loaded = true;
  require.cache[resolved].exports = stub;
}

const API_KEY = 'test-secret-key';
const BIG_ATOMIC = '9007199254740993';  // 2^53 + 1: exact in a string, rounded by a double

const daemonBody = {
  snapshot_height: 4242,
  snapshot_block_hash: 'abc123',
  xfg_removed_from_circulation_total: BIG_ATOMIC,
  eternal_flame_burn_total_xfg: '1500000000',
  swf_xfg_permanently_retired_total: '9007199254740991',
  note_xfg_removed_from_circulation: 'Total XFG removed from circulation',
  note_reconciliation: 'independently sourced',
  treasury_accounts: {
    legacy_counter_xfg: '0',
    pending_xfg: '250000000',
    heat_reserve: '125000000',
    bonus_vault_counter_heat: '70000000',
    vault_general_xfg: '9007199254740995',
    vault_general_heat: '0',
    vault_lp_reserve_xfg: '3000000000',
    vault_lp_reserve_heat: '1500000000'
  },
  cd_yield_accounting: {
    pending_xfg: '40000000',
    claims_counter_heat: '9007199254740999',
    apy_pool_vault_heat: '3000000000',
    base_claim_cap_heat: '3000000000'
  },
  hearth_pool: {
    pool_reserve_xfg: '1000000000000',
    pool_reserve_heat: '100000000000',
    pool_total_lp_shares: '1000000000',
    protocol_lp_shares: '50000000',
    protocol_lp_value_xfg: '50000000000',
    protocol_lp_value_heat: '5000000000'
  },
  swf_accounts: {
    collateral_pending_xfg: BIG_ATOMIC,
    heat_counter: '60000000',
    vault_swf_xfg: '0',
    vault_swf_heat: '0'
  },
  status: 'OK'
};

const AMOUNT_PATHS = [
  ['xfg_removed_from_circulation_total'],
  ['eternal_flame_burn_total_xfg'],
  ['swf_xfg_permanently_retired_total'],
  ['treasury_accounts', 'legacy_counter_xfg'],
  ['treasury_accounts', 'pending_xfg'],
  ['treasury_accounts', 'heat_reserve'],
  ['treasury_accounts', 'bonus_vault_counter_heat'],
  ['treasury_accounts', 'vault_general_xfg'],
  ['treasury_accounts', 'vault_general_heat'],
  ['treasury_accounts', 'vault_lp_reserve_xfg'],
  ['treasury_accounts', 'vault_lp_reserve_heat'],
  ['cd_yield_accounting', 'pending_xfg'],
  ['cd_yield_accounting', 'claims_counter_heat'],
  ['cd_yield_accounting', 'apy_pool_vault_heat'],
  ['cd_yield_accounting', 'base_claim_cap_heat'],
  ['hearth_pool', 'pool_reserve_xfg'],
  ['hearth_pool', 'pool_reserve_heat'],
  ['hearth_pool', 'pool_total_lp_shares'],
  ['hearth_pool', 'protocol_lp_shares'],
  ['hearth_pool', 'protocol_lp_value_xfg'],
  ['hearth_pool', 'protocol_lp_value_heat'],
  ['swf_accounts', 'collateral_pending_xfg'],
  ['swf_accounts', 'heat_counter'],
  ['swf_accounts', 'vault_swf_xfg'],
  ['swf_accounts', 'vault_swf_heat']
];

let daemon;
let gatewayPort;
let gatewayServer;
let dbPath;

// server.js keeps its http.Server private and listens at require time. Capture
// it through the module factory so the test can shut it down and exit.
function captureServer() {
  const real = http.createServer;
  http.createServer = function (...args) {
    const server = real.apply(this, args);
    gatewayServer = server;
    return server;
  };
  return () => { http.createServer = real; };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

before(async () => {
  daemon = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(daemonBody));
  });
  const daemonPort = await listen(daemon);

  gatewayPort = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });

  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xfgapi-test-')), 'candles.db');

  stubSqlite();
  const restoreCreateServer = captureServer();

  process.env.PORT = String(gatewayPort);
  process.env.CORE_RPC_URL = `http://127.0.0.1:${daemonPort}`;
  process.env.DB_PATH = dbPath;
  process.env.GATEWAY_API_KEY = API_KEY;

  require('../server.js');
  restoreCreateServer();
  if (gatewayServer) gatewayServer.unref();
  await new Promise((resolve) => setTimeout(resolve, 500));
});

after(() => {
  // server.js attaches a WebSocketServer and leaves stdio pipes open, so the
  // test process would otherwise never exit after the servers are closed.
  for (const server of [gatewayServer, daemon]) {
    if (!server) continue;
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close();
  }
  if (dbPath) fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

test('forwards /get_public_audit to the daemon', async () => {
  const res = await get(gatewayPort, '/v1/node/audit/balances');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(JSON.parse(res.body), daemonBody);
});

test('requires no API key even when one is configured', async () => {
  const withoutKey = await get(gatewayPort, '/v1/node/audit/balances');
  assert.strictEqual(withoutKey.status, 200);

  // The gateway-wide guard is genuinely active, so this is a real exemption
  // rather than an auth check that never fires.
  const guarded = await get(gatewayPort, '/v1/wallet/balance');
  assert.strictEqual(guarded.status, 401);

  const wrongKey = await get(gatewayPort, '/v1/wallet/balance', { 'X-API-Key': 'wrong' });
  assert.strictEqual(wrongKey.status, 401);
});

test('preserves every monetary value as an exact decimal string', async () => {
  const res = await get(gatewayPort, '/v1/node/audit/balances');
  const parsed = JSON.parse(res.body);

  for (const keys of AMOUNT_PATHS) {
    const value = keys.reduce((node, k) => node[k], parsed);
    assert.strictEqual(typeof value, 'string', `${keys.join('.')} is not a string`);
    assert.match(value, /^[0-9]+$/, `${keys.join('.')} is not a decimal integer string`);
  }

  // Quoted on the wire, not a JSON number.
  assert.ok(
    res.body.includes(`"xfg_removed_from_circulation_total":"${BIG_ATOMIC}"`),
    'aggregate is not a quoted string on the wire'
  );

  // The reason: a double would round these. If a number ever appears here, the
  // exact value is already gone by the time a JavaScript client reads it.
  assert.strictEqual(Number(BIG_ATOMIC), 9007199254740992);
  assert.notStrictEqual(Number(BIG_ATOMIC), BigInt(BIG_ATOMIC));
});