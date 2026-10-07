// Third pass: for each (product, chain) still missing, list that chain's store items whose name
// contains a keyword (storeSnapshot + category filter). Stops before the free $5 runs out.
import fs from 'node:fs';
const token = process.env.APIFY_TOKEN;
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const api = 'https://api.apify.com/v2';
const KEYWORD = {
  2: 'ביצים', 11: 'חזה עוף', 14: 'כרעיים', 15: 'שניצל עוף', 20: 'סלמון', 21: 'עגבני', 22: 'מלפפון',
  23: 'תפוח אדמה', 24: 'בצל', 25: 'גזר', 28: 'קישוא', 29: 'בננ', 31: 'תפוז', 32: 'לימון', 33: 'אבוקדו',
  41: 'שמן זית', 42: 'טחינה', 45: 'רסק', 46: 'תירס', 47: 'קורנפלקס', 49: 'תה ', 54: 'מים מינרלים',
  59: 'ג\'ל כביסה', 60: 'משחת שיניים',
};
const PER_RUN = 15, BUDGET_STOP = 4.8;
const basket = JSON.parse(fs.readFileSync('basket.json', 'utf8'));
const chains = Object.keys(basket.chains);
const jobs = [];
for (const p of basket.products) for (const c of chains) if (!p.prices[c] && KEYWORD[p.id]) jobs.push({ id: p.id, c, kw: KEYWORD[p.id] });

const outFile = 'raw_gaps.json';
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { done: {} };
const save = () => fs.writeFileSync(outFile, JSON.stringify(out));

async function getJson(url, opts = {}) {
  for (let i = 1; i <= 6; i++) {
    try { const res = await fetch(url, { headers: H, ...opts }); if (res.ok) return res.json(); console.error(res.status, (await res.text()).slice(0, 150)); }
    catch (e) { console.error('network:', e.cause?.code || e.message); }
    await new Promise(r => setTimeout(r, 4000 * i));
  }
  throw new Error('failed ' + url);
}
const used = async () => (await getJson(`${api}/users/me/limits`)).data.current.monthlyUsageUsd;
async function run(input) {
  let r = (await getJson(`${api}/acts/swerve~supermarket-prices/runs`, { method: 'POST', body: JSON.stringify(input) })).data;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(r.status)) r = (await getJson(`${api}/actor-runs/${r.id}?waitForFinish=50`)).data;
  if (r.status !== 'SUCCEEDED') throw new Error('run ' + r.status);
  return getJson(`${api}/datasets/${r.defaultDatasetId}/items?clean=true`);
}

const queue = jobs.filter(j => !out.done[`${j.id}:${j.c}`]);
console.log(`${queue.length} gaps to fill`);
let stop = false, n = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length && !stop) {
    const j = queue.shift();
    const u = await used();
    if (u > BUDGET_STOP) { stop = true; console.log(`stopping: $${u.toFixed(2)} used`); break; }
    try {
      const rows = await run({ mode: 'storeSnapshot', chain: j.c, category: j.kw, maxItems: PER_RUN, includeImages: false });
      (out[j.id] ||= []).push(...rows); out.done[`${j.id}:${j.c}`] = true; save();
      console.log(`[${++n}] #${j.id} ${j.c} "${j.kw}": ${rows.length} rows`);
    } catch (e) { console.error(`#${j.id} ${j.c}: ${e.message}`); }
  }
}));
console.log(`gaps done, $${(await used()).toFixed(2)} used`);
