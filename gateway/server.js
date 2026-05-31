const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 8787;
const CORE_RPC_URL = process.env.CORE_RPC_URL || 'http://127.0.0.1:18180';
const WALLET_RPC_URL = process.env.WALLET_RPC_URL || 'http://127.0.0.1:8070/json_rpc';
const WALLET_RPC_USER = process.env.WALLET_RPC_USER || '';
const WALLET_RPC_PASSWORD = process.env.WALLET_RPC_PASSWORD || '';

const app = express();
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function walletHeaders() {
  if (WALLET_RPC_USER || WALLET_RPC_PASSWORD) {
    const token = Buffer.from(`${WALLET_RPC_USER}:${WALLET_RPC_PASSWORD}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }
  return {};
}

async function coreGet(path, query = {}) {
  const qs = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
  const r = await fetch(`${CORE_RPC_URL}${path}${qs}`);
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  return data;
}

async function coreJsonRpc(method, params = {}) {
  const res = await fetch(`${CORE_RPC_URL}/json_rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Core RPC error');
    err.code = data.error.code;
    throw err;
  }
  return data.result;
}

async function walletJsonRpc(method, params = {}) {
  const res = await fetch(WALLET_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...walletHeaders() },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Wallet RPC error');
    err.code = data.error.code;
    throw err;
  }
  return data.result;
}

// ───────────────────────────────────────────────
//  HEALTH
// ───────────────────────────────────────────────
app.get('/v1/health', (req, res) => res.json({ ok: true }));

// ───────────────────────────────────────────────
//  NODE — Core Info
// ───────────────────────────────────────────────
app.get('/v1/node/info', async (req, res) => {
  try { res.json(await coreGet('/getinfo')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/height', async (req, res) => {
  try { res.json(await coreGet('/getheight')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/blockcount', async (req, res) => {
  try { res.json(await coreJsonRpc('getblockcount')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/node/last_block_header', async (req, res) => {
  try { res.json(await coreJsonRpc('getlastblockheader')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/node/block_header_by_height/:height', async (req, res) => {
  try { res.json(await coreJsonRpc('getblockheaderbyheight', { height: Number(req.params.height) })); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/node/block/:hash', async (req, res) => {
  try { res.json(await coreJsonRpc('f_block_json', { hash: req.params.hash })); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/node/transaction/:hash', async (req, res) => {
  try { res.json(await coreJsonRpc('f_transaction_json', { hash: req.params.hash })); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/node/reserve-proof', async (req, res) => {
  try { res.json(await coreJsonRpc('check_reserve_proof', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

// ───────────────────────────────────────────────
//  NODE — Blocks & MemPool (JSON-RPC)
// ───────────────────────────────────────────────
app.get('/v1/node/blocks/list', async (req, res) => {
  try { res.json(await coreJsonRpc('f_blocks_list_json')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/node/pool/transactions', async (req, res) => {
  try { res.json(await coreJsonRpc('f_on_transactions_pool_json')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

// ───────────────────────────────────────────────
//  HEAT — Stablecoin Metrics
// ───────────────────────────────────────────────
app.get('/v1/node/heat/metrics', async (req, res) => {
  try { res.json(await coreGet('/heat_metrics')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/eternal-flame', async (req, res) => {
  try { res.json(await coreGet('/getethereal')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ───────────────────────────────────────────────
//  HEARTH AMM — On-chain XFG↔HEAT pool
// ───────────────────────────────────────────────
app.get('/v1/node/amm/pool', async (req, res) => {
  try { res.json(await coreGet('/amm_pool_info')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/amm/quote', async (req, res) => {
  try { res.json(await coreGet('/amm_quote', req.query)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ───────────────────────────────────────────────
//  FEE POOL & TREASURY
// ───────────────────────────────────────────────
app.get('/v1/node/fee-pool', async (req, res) => {
  try { res.json(await coreGet('/get_fee_pool_info')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/epoch/history', async (req, res) => {
  try { res.json(await coreGet('/get_epoch_history')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/treasury', async (req, res) => {
  try { res.json(await coreGet('/get_treasury_info')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ───────────────────────────────────────────────
//  CDs — Commitment Deposits
// ───────────────────────────────────────────────
app.get('/v1/node/deposits', async (req, res) => {
  try { res.json(await coreGet('/getdeposits')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/cd/yield', async (req, res) => {
  try { res.json(await coreGet('/estimate_cd_yield', req.query)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/maturing-deposits', async (req, res) => {
  try { res.json(await coreGet('/get_maturing_deposits')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ───────────────────────────────────────────────
//  ALIASES
// ───────────────────────────────────────────────
app.get('/v1/node/alias/:name', async (req, res) => {
  try { res.json(await coreGet('/get_alias', { name: req.params.name })); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/alias/by-address/:address', async (req, res) => {
  try { res.json(await coreGet('/get_alias_by_address', { address: req.params.address })); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/aliases', async (req, res) => {
  try { res.json(await coreGet('/get_all_aliases')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ───────────────────────────────────────────────
//  SWAPS — Atomic Swap Data & Pricing
// ───────────────────────────────────────────────
app.get('/v1/node/swaps/price', async (req, res) => {
  try { res.json(await coreGet('/getswapprice', req.query)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/swaps/offers', async (req, res) => {
  try { res.json(await coreGet('/getswapoffers', req.query)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/swaps/trades', async (req, res) => {
  try { res.json(await coreGet('/getswaptrades', req.query)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ───────────────────────────────────────────────
//  ZK BRIDGE — Commitment Index Proofs
// ───────────────────────────────────────────────
app.get('/v1/node/commitment/stats', async (req, res) => {
  try { res.json(await coreGet('/get_commitment_stats')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/commitment/merkle-root', async (req, res) => {
  try { res.json(await coreGet('/get_commitment_merkle_root')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/commitment/proof/:id', async (req, res) => {
  try { res.json(await coreGet('/get_commitment_merkle_proof', { id: req.params.id })); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ───────────────────────────────────────────────
//  WALLET
// ───────────────────────────────────────────────
app.get('/v1/wallet/balance', async (req, res) => {
  try { res.json(await walletJsonRpc('getbalance')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/wallet/height', async (req, res) => {
  try { res.json(await walletJsonRpc('get_height')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/transfers', async (req, res) => {
  try { res.json(await walletJsonRpc('get_transfers', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/transfer', async (req, res) => {
  try { res.json(await walletJsonRpc('transfer', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/optimize', async (req, res) => {
  try { res.json(await walletJsonRpc('optimize', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

// ───────────────────────────────────────────────
//  WALLET — CDs (hearth)
// ───────────────────────────────────────────────
app.get('/v1/wallet/cds', async (req, res) => {
  try { res.json(await walletJsonRpc('list_cds')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/cds/create', async (req, res) => {
  try { res.json(await walletJsonRpc('create_cd', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/cds/withdraw', async (req, res) => {
  try { res.json(await walletJsonRpc('withdraw_cd', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/cds/rollover', async (req, res) => {
  try { res.json(await walletJsonRpc('rollover_cd', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/wallet/cds/yield', async (req, res) => {
  try { res.json(await walletJsonRpc('estimate_cd_yield', req.query)); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

// ───────────────────────────────────────────────
//  DAEMON PROXY — catch-all for direct daemon passthrough
// ───────────────────────────────────────────────
const TESTNET_RPC_URL = process.env.TESTNET_RPC_URL || 'http://127.0.0.1:28280';

async function proxyDaemon(req, res, rpcUrl) {
  try {
    const path = req.params[0] ? '/' + req.params[0] : '';
    const daemonUrl = `${rpcUrl}${path}`;
    if (req.method === 'GET') {
      const qs = Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '';
      const r = await fetch(`${daemonUrl}${qs}`);
      const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
      res.json(data);
    } else if (req.method === 'POST') {
      const r = await fetch(daemonUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      const data = await r.json();
      res.json(data);
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (e) {
    if (req.method === 'POST' && req.body && req.body.jsonrpc) {
      return res.status(502).json({
        jsonrpc: req.body.jsonrpc,
        id: req.body.id || null,
        error: { code: -32603, message: 'Daemon unreachable: ' + e.message }
      });
    }
    res.status(502).json({ error: e.message });
  }
}

app.all('/v1/daemon/*', (req, res) => proxyDaemon(req, res, CORE_RPC_URL));
app.all('/v1/daemon-testnet/*', (req, res) => proxyDaemon(req, res, TESTNET_RPC_URL));

// ───────────────────────────────────────────────
//  STARTUP
// ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Fuego API gateway listening on http://localhost:${PORT}`);
  console.log(`  Core RPC: ${CORE_RPC_URL}`);
  console.log(`  Wallet RPC: ${WALLET_RPC_URL}`);
});
