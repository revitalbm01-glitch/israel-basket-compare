// Pulls prices for the 60 products from Apify actor swerve/supermarket-prices.
// One actor run per product so every row is tagged with its product id.
// Usage: APIFY_TOKEN=... node fetch.mjs
import fs from 'node:fs';

const token = process.env.APIFY_TOKEN;
if (!token) { console.error('APIFY_TOKEN is not set'); process.exit(1); }

const products = JSON.parse(fs.readFileSync(new URL('./products.json', import.meta.url), 'utf8'));
const CHAINS = ['shufersal', 'rami-levy', 'carrefour', 'victory', 'yochananof', 'osher-ad', 'tiv-taam', 'hazi-hinam'];
const MAX_ROWS_PER_CHAIN = 3;
const CONCURRENCY = 4;
const outFile = new URL('./raw_prices.json', import.meta.url);
const done = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};

const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const api = 'https://api.apify.com/v2';
async function getJson(url, opts = {}) {
  for (let i = 1; i <= 5; i++) {
    try {
      const res = await fetch(url, { headers: H, ...opts });
      if (res.ok) return res.json();
      console.error(`${res.status} ${(await res.text()).slice(0, 150)}`);
    } catch (e) { console.error('network:', e.cause?.code || e.message); }
    await new Promise(r => setTimeout(r, 3000 * i));
  }
  throw new Error('request failed: ' + url);
}

// Start the run, poll until it finishes, then read its dataset (avoids long-held connections).
async function runOne(p) {
  const input = {
    mode: 'compareProducts',
    productQueries: [p.q],
    chains: CHAINS,
    oneStorePerChain: true,
    includeImages: false,
    maxRowsPerChain: MAX_ROWS_PER_CHAIN,
    maxItems: CHAINS.length * MAX_ROWS_PER_CHAIN,
  };
  try {
    let run = (await getJson(`${api}/acts/swerve~supermarket-prices/runs`, { method: 'POST', body: JSON.stringify(input) })).data;
    while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status))
      run = (await getJson(`${api}/actor-runs/${run.id}?waitForFinish=50`)).data;
    if (run.status !== 'SUCCEEDED') { console.error(`#${p.id} run ${run.status}`); return null; }
    return await getJson(`${api}/datasets/${run.defaultDatasetId}/items?clean=true`);
  } catch (e) { console.error(`#${p.id}: ${e.message}`); return null; }
}

const queue = products.filter(p => !done[p.id]);
let n = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const p = queue.shift();
    const rows = await runOne(p);
    if (rows) {
      done[p.id] = rows;
      fs.writeFileSync(outFile, JSON.stringify(done));
    }
    console.log(`[${++n}] #${p.id} ${p.name}: ${rows ? rows.length + ' rows' : 'FAILED'}`);
  }
}));
const total = Object.values(done).reduce((s, r) => s + r.length, 0);
console.log(`Done: ${Object.keys(done).length}/${products.length} products, ${total} rows (~$${(total * 0.002).toFixed(2)})`);
