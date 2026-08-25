const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 8787;
const CORE_RPC_URL = process.env.CORE_RPC_URL || 'http://127.0.0.1:18180';
const WALLET_RPC_URL = process.env.WALLET_RPC_URL || 'http://127.0.0.1:8070/json_rpc';
const TESTNET_RPC_URL = process.env.TESTNET_RPC_URL || 'http://127.0.0.1:28280';
const WALLET_RPC_USER = process.env.WALLET_RPC_USER || '';
const WALLET_RPC_PASSWORD = process.env.WALLET_RPC_PASSWORD || '';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'candles.db');

const app = express();
const server = http.createServer(app);
app.use(bodyParser.json());

// ───────────────────────────────────────────────
//  DATABASE INIT
// ───────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS hearth_candles (
    ts      INTEGER,
    period  INTEGER,
    open    INTEGER NOT NULL,
    high    INTEGER NOT NULL,
    low     INTEGER NOT NULL,
    close   INTEGER NOT NULL,
    volume  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ts, period)
  );
`);

const insertTickStmt = db.prepare(`
  INSERT INTO hearth_candles (ts, period, open, high, low, close, volume)
  VALUES (@ts, @period, @price, @price, @price, @price, @volume)
  ON CONFLICT(ts, period) DO UPDATE SET
    high = MAX(high, @price),
    low = MIN(low, @price),
    close = @price,
    volume = volume + @volume
`);

function insertTick(price, volumeDelta) {
  const now = Math.floor(Date.now() / 1000);
  const periods = [60, 300, 900, 3600];
  const tx = db.transaction(() => {
    for (const p of periods) {
      const ts = now - (now % p);
      insertTickStmt.run({ ts, period: p, price, volume: volumeDelta });
    }
  });
  tx();
}

// ───────────────────────────────────────────────
//  WEBSOCKET BRIDGE
// ───────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/v1/ws/blocks' });

// ───────────────────────────────────────────────
//  CORS & HEADERS
// ───────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ───────────────────────────────────────────────
//  RATE LIMITING & AUTH
// ───────────────────────────────────────────────
const limiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true });
app.use('/v1/', limiter);

function requireApiKey(req, res, next) {
  if (!GATEWAY_API_KEY) return next(); // unauthenticated (dev mode) if no key configured
  const provided = req.headers['x-api-key'] || (req.headers.authorization || '').replace('Bearer ', '');
  if (provided !== GATEWAY_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ───────────────────────────────────────────────
//  RPC FETCHERS
// ───────────────────────────────────────────────
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
//  BACKGROUND POLLING
// ───────────────────────────────────────────────
let lastHeight = 0;
let epochDuration = 900; // default mainnet

// Determine network on startup
coreGet('/getinfo').then(info => {
  if (info && info.testnet) epochDuration = 10;
}).catch(() => {});

let lastReserveXfg = 0;
setInterval(async () => {
  try {
    // 1. Tick Price
    const pool = await coreGet('/amm_pool_info');
    if (pool && pool.spot_price) {
      let volumeDelta = 0;
      if (lastReserveXfg !== 0 && pool.reserve_xfg > lastReserveXfg) {
        volumeDelta = pool.reserve_xfg - lastReserveXfg;
      }
      insertTick(pool.spot_price, volumeDelta);
      lastReserveXfg = pool.reserve_xfg;
    }
    
    // 2. Tick Block & Epoch
    const hInfo = await coreGet('/getheight');
    if (hInfo && hInfo.height > lastHeight) {
      lastHeight = hInfo.height;
      wss.clients.forEach(c => {
        if (c.readyState === 1) c.send(JSON.stringify({ type: 'height', height: lastHeight }));
      });
      if (lastHeight % epochDuration === 0) {
        wss.clients.forEach(c => {
          if (c.readyState === 1) c.send(JSON.stringify({ type: 'epoch', height: lastHeight }));
        });
      }
    }
  } catch(e) {}
}, 15_000);

// ───────────────────────────────────────────────
//  HEALTH & DOCS
// ───────────────────────────────────────────────
app.get('/v1/health', (req, res) => res.json({ ok: true }));

app.get('/v1/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'openapi.yaml'));
});

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

app.post('/v1/node/check-tx-key', async (req, res) => {
  try { res.json(await coreJsonRpc('check_tx_key', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/node/check-tx-view-key', async (req, res) => {
  try { res.json(await coreJsonRpc('check_tx_with_view_key', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/node/reserve-proof', async (req, res) => {
  try { res.json(await coreJsonRpc('check_reserve_proof', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/node/transactions-by-payment-id', async (req, res) => {
  try { res.json(await coreJsonRpc('k_transactions_by_payment_id', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

// ───────────────────────────────────────────────
//  NODE — Blocks & MemPool (JSON-RPC)
// ───────────────────────────────────────────────
app.get('/v1/node/blocks/list', async (req, res) => {
  try {
    var params = {};
    if (req.query.height) params.height = Number(req.query.height);
    res.json(await coreJsonRpc('f_blocks_list_json', params));
  }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/node/pool/transactions', async (req, res) => {
  try { res.json(await coreJsonRpc('f_on_transactions_pool_json')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/node/pool/mempool', async (req, res) => {
  try { res.json(await coreJsonRpc('f_mempool_json')); }
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
app.get('/v1/hearth/pool', async (req, res) => {
  try { res.json(await coreGet('/amm_pool_info')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/node/amm/quote', async (req, res) => {
  try { res.json(await coreGet('/amm_quote', req.query)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/v1/hearth/quote', async (req, res) => {
  try { res.json(await coreGet('/amm_quote', req.query)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/hearth/price', async (req, res) => {
  try { res.json(await coreGet('/get_fuego_price')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

function aggregateOrderbook(orders) {
  const bids = new Map();
  const asks = new Map();
  for (const o of orders) {
    if (!o.active) continue;
    const map = o.direction === 0 ? bids : asks; // 0 = XFG->HEAT (bid), 1 = HEAT->XFG (ask)
    if (!map.has(o.target_price)) map.set(o.target_price, { price: o.target_price, amount: 0, depth: 0, order_ids: [] });
    const lvl = map.get(o.target_price);
    lvl.amount += o.amount;
    lvl.depth += o.amount;
    lvl.order_ids.push(o.order_id);
  }
  return {
    bids: Array.from(bids.values()).sort((a, b) => b.price - a.price), // desc
    asks: Array.from(asks.values()).sort((a, b) => a.price - b.price), // asc
    timestamp: Math.floor(Date.now() / 1000)
  };
}

app.get('/v1/hearth/orderbook', async (req, res) => {
  try {
    const params = {};
    if (req.query.active_only) params.active_only = req.query.active_only === 'true';
    if (req.query.limit)       params.limit = Number(req.query.limit);
    if (req.query.offset)      params.offset = Number(req.query.offset);
    const data = await coreGet('/get_limit_orders', params);
    res.json(aggregateOrderbook(data.orders || []));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/v1/hearth/ohlcv', (req, res) => {
  try {
    const period = Number(req.query.period || 300);
    const count = Number(req.query.count || 100);
    const rows = db.prepare(`SELECT ts AS t, open AS o, high AS h, low AS l, close AS c, volume AS v FROM hearth_candles WHERE period = ? ORDER BY ts DESC LIMIT ?`).all(period, count);
    res.json(rows.reverse()); // return ascending
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Write routes (Protected)
app.post('/v1/hearth/swap', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('amm_swap', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});
app.post('/v1/hearth/order/place', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('place_limit_order', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});
app.post('/v1/hearth/order/cancel', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('cancel_limit_order', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});
app.get('/v1/hearth/orders', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('get_limit_orders', req.query || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});
app.post('/v1/hearth/lp/add', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('amm_add_liquidity', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});
app.post('/v1/hearth/lp/remove', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('amm_remove_liquidity', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});
app.post('/v1/hearth/heat/mint', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('heat_mint', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
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
//  WALLET (Protected)
// ───────────────────────────────────────────────
app.get('/v1/wallet/balance', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('getbalance')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/wallet/height', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('get_height')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/transfers', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('get_transfers', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/transfer', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('transfer', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/optimize', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('optimize', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

// ───────────────────────────────────────────────
//  WALLET — CDs (hearth) (Protected)
// ───────────────────────────────────────────────
app.get('/v1/wallet/cds', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('list_cds')); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/cds/create', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('create_cd', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/cds/withdraw', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('withdraw_cd', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.post('/v1/wallet/cds/rollover', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('rollover_cd', req.body || {})); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

app.get('/v1/wallet/cds/yield', requireApiKey, async (req, res) => {
  try { res.json(await walletJsonRpc('estimate_cd_yield', req.query)); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});

// ───────────────────────────────────────────────
//  DAEMON PROXY — catch-all for direct daemon passthrough
// ───────────────────────────────────────────────
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
server.listen(PORT, () => {
  console.log(`Fuego API gateway listening on http://localhost:${PORT}`);
  console.log(`  Core RPC: ${CORE_RPC_URL}`);
  console.log(`  Wallet RPC: ${WALLET_RPC_URL}`);
  console.log(`  Auth Enabled: ${GATEWAY_API_KEY ? 'Yes' : 'No (WARNING: Open Write Access)'}`);
});
