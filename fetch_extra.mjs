// Second pass to fill gaps:
//  (a) packaged goods: the barcode seen at the most chains, queried by exact barcode (same product everywhere)
//  (b) produce/fresh meat: sharper name queries with more rows per chain
import fs from 'node:fs';
import { SPEC, packSize } from './spec.mjs';

const token = process.env.APIFY_TOKEN;
const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
const raw = JSON.parse(fs.readFileSync('raw_prices.json', 'utf8'));
const CHAINS = ['shufersal', 'rami-levy', 'carrefour', 'yochananof', 'osher-ad', 'tiv-taam'];
const EXCLUDE = ['אורגני', 'אומגה', 'פרימיום', 'לולו', 'בוטיק', 'ללא גלוטן', 'טבעוני'];
const norm = s => (s || '').replace(/["'׳״`]/g, '');
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const api = 'https://api.apify.com/v2';

const FRESH_QUERIES = {
  16: 'בקר טחון', 17: 'פרגית', 21: 'עגבניה', 22: 'מלפפון', 23: 'תפוח אדמה', 25: 'גזר',
  26: 'פלפל אדום', 29: 'בננה', 30: 'תפוח עץ', 31: 'תפוז', 32: 'לימון', 9: 'לאבנה',
};

// (a) choose barcodes
const barcodeOf = {};
for (const p of products) {
  const spec = SPEC[p.id] || {};
  if (spec.kg || FRESH_QUERIES[p.id]) continue;
  const ex = [...EXCLUDE, ...(spec.ex || [])].map(norm);
  const seen = {};
  for (const r of raw[p.id] || []) {
    const n = norm(r.itemName);
    if (!p.must.map(norm).every(k => n.includes(k)) || ex.some(k => n.includes(k))) continue;
    if ((spec.any || []).length && !spec.any.some(k => n.includes(norm(k)))) continue;
    if (spec.size) { const g = packSize(r); if (!g || g < spec.size * 0.6 || g > spec.size * 1.7) continue; }
    if (!/^729\d{10}$/.test(r.barcode)) continue; // national barcodes only
    (seen[r.barcode] ||= { chains: new Set(), prices: [] }).chains.add(r.chainKey);
    seen[r.barcode].prices.push(r.price);
  }
  const best = Object.entries(seen).sort((a, b) => b[1].chains.size - a[1].chains.size || Math.min(...a[1].prices) - Math.min(...b[1].prices))[0];
  if (best) barcodeOf[best[0]] = p.id;
}
console.log('barcodes chosen:', Object.keys(barcodeOf).length);
if (process.argv[2] === 'dry') { console.log(barcodeOf); process.exit(0); }

async function getJson(url, opts = {}) {
  for (let i = 1; i <= 6; i++) {
    try { const res = await fetch(url, { headers: H, ...opts }); if (res.ok) return res.json(); console.error(res.status, (await res.text()).slice(0, 150)); }
    catch (e) { console.error('network:', e.cause?.code || e.message); }
    await new Promise(r => setTimeout(r, 4000 * i));
  }
  throw new Error('failed ' + url);
}
async function run(input) {
  let r = (await getJson(`${api}/acts/swerve~supermarket-prices/runs`, { method: 'POST', body: JSON.stringify(input) })).data;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(r.status)) r = (await getJson(`${api}/actor-runs/${r.id}?waitForFinish=50`)).data;
  if (r.status !== 'SUCCEEDED') throw new Error('run ' + r.status);
  return getJson(`${api}/datasets/${r.defaultDatasetId}/items?clean=true`);
}

const outFile = 'raw_extra.json';
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const save = () => fs.writeFileSync(outFile, JSON.stringify(out));
const base = { mode: 'compareProducts', chains: CHAINS, oneStorePerChain: true, includeImages: false };

const jobs = [];
if (!out._barcodesDone) jobs.push((async () => {
  const rows = await run({ ...base, barcodes: Object.keys(barcodeOf), maxItems: Object.keys(barcodeOf).length * CHAINS.length * 2 });
  for (const r of rows) { const id = barcodeOf[r.barcode]; if (id) (out[id] ||= []).push(r); }
  out._barcodesDone = true; save();
  console.log(`barcodes: ${rows.length} rows`);
})());
const queue = Object.entries(FRESH_QUERIES).filter(([id]) => !out['_q' + id]);
for (let w = 0; w < 3; w++) jobs.push((async () => {
  while (queue.length) {
    const [id, q] = queue.shift();
    try {
      const rows = await run({ ...base, productQueries: [q], maxRowsPerChain: 8, maxItems: 48 });
      (out[id] ||= []).push(...rows); out['_q' + id] = true; save();
      console.log(`#${id} ${q}: ${rows.length} rows`);
    } catch (e) { console.error(`#${id}: ${e.message}`); }
  }
})());
await Promise.allSettled(jobs);
console.log('extra done');
