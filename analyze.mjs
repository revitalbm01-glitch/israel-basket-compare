// Picks one comparable item per product per chain and totals the basket.
// Rule: among items matching the product's keywords and size rules (spec.mjs), take the
// cheapest normalized price; then drop outliers (>2.2x or <1/2.2 of the cross-chain median).
import fs from 'node:fs';
import { SPEC, packSize } from './spec.mjs';

const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
const raw = JSON.parse(fs.readFileSync('raw_prices.json', 'utf8'));
const gaps = fs.existsSync('raw_gaps.json') ? JSON.parse(fs.readFileSync('raw_gaps.json', 'utf8')) : {};
const extra = fs.existsSync('raw_extra.json') ? JSON.parse(fs.readFileSync('raw_extra.json', 'utf8')) : {};
const CHAINS = { 'shufersal': 'שופרסל', 'rami-levy': 'רמי לוי', 'carrefour': 'קרפור', 'yochananof': 'יוחננוף', 'osher-ad': 'אושר עד', 'tiv-taam': 'טיב טעם' };
const EXCLUDE = ['אורגני', 'אומגה', 'פרימיום', 'לולו', 'בוטיק', 'ללא גלוטן', 'טבעוני'];

const norm = s => (s || '').replace(/["'׳״`]/g, '');
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Egg packs come as 12, 18, 30 or 2*30: price per dozen
function eggCount(name) {
  const m = name.match(/(\d+)\s*\*\s*(\d+)/);
  if (m) return +m[1] * +m[2];
  const n = (name.match(/\d+/g) || []).map(Number).find(x => [6, 10, 12, 18, 20, 24, 30].includes(x));
  return n || null;
}

function normalizedPrice(r, spec) {
  if (spec.unit) return r.price;
  if (spec.eggs) { const n = eggCount(r.itemName); return n ? r.price / n * 12 : null; }
  if (spec.kg) {
    if (r.isWeighted) return r.price;                 // weighted items are priced per kg
    const g = packSize(r);
    return g && g >= 200 ? r.price / g * 1000 : null; // packed meat/produce → per kg
  }
  const g = packSize(r);
  if (!g || g < spec.size * 0.4 || g > spec.size * 2.5) return null;
  return r.price / g * spec.size;
}

const result = [];
for (const p of products) {
  const spec = SPEC[p.id] || { unit: true };
  const must = p.must.map(norm);
  const exclude = [...EXCLUDE, ...(spec.ex || [])].map(norm);
  const any = (spec.any || []).map(norm);
  const FRESH = [9, 16, 17, 21, 22, 23, 25, 26, 29, 30, 31, 32];
  const exact = FRESH.includes(p.id) ? [] : (extra[p.id] || []);
  const exactChains = new Set(exact.map(r => r.chainKey));
  // Packaged goods: when the same barcode was found at 4+ chains, compare that exact product;
  // other chains fall back to the closest matching item (marked alt).
  const useExact = exactChains.size >= 4;
  const rows = useExact
    ? [...exact.map(r => ({ ...r, _exact: true })), ...(raw[p.id] || []).filter(r => !exactChains.has(r.chainKey))]
    : [...(raw[p.id] || []), ...(extra[p.id] || [])];
  rows.push(...(gaps[p.id] || []).filter(r => !(useExact && exactChains.has(r.chainKey))));
  const cands = [];
  for (const r of rows) {
    const n = norm(r.itemName);
    if (!CHAINS[r.chainKey] || !(r.price > 0)) continue;
    if (!r._exact) {
      if (!must.every(k => n.includes(k)) || exclude.some(k => n.includes(k))) continue;
      if (any.length && !any.some(k => n.includes(k))) continue;
    }
    const v = normalizedPrice(r, spec);
    if (v == null) continue;
    if (spec.weighedOnly && !r.isWeighted && packSize(r) !== 1000) continue;
    cands.push({ v, r });
  }
  // Cheapest per chain, but only among candidates near the cross-chain median (drops mismatched items)
  const cheapest = {};
  for (const c of cands) if (!cheapest[c.r.chainKey] || c.v < cheapest[c.r.chainKey]) cheapest[c.r.chainKey] = c.v;
  const med = median(Object.values(cheapest));
  const pick = {};
  for (const c of cands) {
    if (c.v > med * 2.2 || c.v < med / 2.2) continue;
    if (!pick[c.r.chainKey] || c.v < pick[c.r.chainKey].v) pick[c.r.chainKey] = c;
  }
  result.push({
    ...p,
    basis: spec.eggs ? 'לתריסר (12 ביצים)' : spec.kg ? 'לק"ג' : spec.size ? `מנורמל ל-${spec.size >= 1000 ? spec.size / 1000 + (p.name.match(/ליטר|מ"ל|מים|שמן|חלב|קולה|מיץ|נוזל|ג'ל/) ? ' ל\'' : ' ק"ג') : spec.size + (p.name.match(/מ"ל|ליטר|משחת/) ? ' מ"ל' : ' גר\'')}` : 'כפי שנמכר',
    prices: Object.fromEntries(Object.entries(pick).map(([k, { v, r }]) => [k, {
      price: Math.round(v * 100) / 100, shelf: r.price, item: r.itemName.trim(), barcode: r.barcode,
      weighted: !!r.isWeighted, size: packSize(r), date: r.priceUpdateDate, alt: useExact && !r._exact,
    }])),
  });
}
const notes = [
  'מקור הנתונים: קובצי המחירים שהרשתות מפרסמות לפי חוק קידום התחרות בענף המזון, נמשכו דרך Apify (swerve/supermarket-prices), סניף מייצג אחד לכל רשת.',
  'בכל מוצר ובכל רשת נבחר הפריט הזול ביותר שמתאים לתיאור. מוצרים אורגניים, פרימיום ומוצרים משלימים (למשל מלפפונים כבושים במקום טריים) סוננו.',
  'במוצרים ארוזים שנמצא להם ברקוד זהה ברוב הרשתות, הושווה בדיוק אותו מוצר (אותו ברקוד). ברשת שבה הברקוד לא נמצא, נלקח הפריט הדומה ביותר והוא מסומן בכוכבית.',
  'מוצרים ארוזים נורמלו לגודל אחיד (למשל טונה ל-640 גר\', מים לשישייה של 1.5 ליטר), כך שאריזה גדולה או קטנה לא מעוותת את ההשוואה. ירקות, פירות, עוף ובשר מתומחרים לק"ג.',
  'הסל המשותף כולל רק מוצרים שנמצאו בכל הרשתות. מוצר שחסר ברשת אחת לא נכנס לסכום של אף רשת.',
  'המחירים הם מחירי מדף בסניף פיזי אחד של כל רשת (סניף 001 בשופרסל, רמי לוי, יוחננוף ואושר עד, וסניף 002 בקרפור ובטיב טעם), ולא מחירי אתרי האונליין. מבצעים ומחירי מועדון עדיין לא נכללים. מחירים יכולים להשתנות בין סניפים של אותה רשת.',
  'ויקטורי וחצי חינם לא החזירו נתונים מהכלי ולכן לא נכללו.',
];
// Impute missing prices: chains ordered by the cost of the common basket (cheapest first);
// a missing price is taken from the next more expensive chain that has it (else the nearest cheaper one).
{
  const ks = Object.keys(CHAINS);
  const common = result.filter(p => ks.every(k => p.prices[k]));
  const order = ks.map(k => [k, common.reduce((s, p) => s + p.prices[k].price, 0)]).sort((x, y) => x[1] - y[1]).map(x => x[0]);
  for (const p of result) {
    if (!Object.keys(p.prices).length) continue;
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      if (p.prices[k]) continue;
      const src = [...order.slice(i + 1), ...order.slice(0, i).reverse()].find(c => p.prices[c] && !p.prices[c].est);
      if (src) p.prices[k] = { ...p.prices[src], est: true, from: src, alt: false };
    }
  }
  var chainOrder = order;
}
notes.splice(4, 1,
  'כשמוצר לא נמצא ברשת מסוימת, המחיר שלו מוערך לפי הרשת הבאה בסדר היוקר: הרשתות מסודרות לפי עלות הסל המשותף, ונלקח המחיר של הרשת היקרה ממנה הקרובה ביותר. כך מחיר חסר אף פעם לא גורם לרשת להיראות זולה יותר. מחירים משוערים מסומנים ב-~.');
fs.writeFileSync('basket.json', JSON.stringify({ chains: CHAINS, order: chainOrder, generated: new Date().toISOString(), notes, products: result }, null, 1));

for (const p of result) {
  const cells = Object.keys(CHAINS).map(k => (p.prices[k] ? p.prices[k].price.toFixed(2) : '  -  ').padStart(7));
  console.log(String(p.id).padStart(2), p.name.padEnd(28), cells.join(' '));
}
const full = result.filter(p => Object.keys(CHAINS).every(k => p.prices[k]));
console.log(`\nIn all ${Object.keys(CHAINS).length} chains: ${full.length}/${result.length}. Missing ≥2 chains: ${result.filter(p => Object.keys(p.prices).length <= 4).map(p => p.id).join(',')}`);
for (const k of Object.keys(CHAINS)) console.log(CHAINS[k], full.reduce((s, p) => s + p.prices[k].price, 0).toFixed(2), '| coverage', result.filter(p => p.prices[k]).length);
