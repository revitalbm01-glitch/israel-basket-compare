import fs from 'node:fs';
// Default basket: a typical weekly shop for a family of four (units, or kg for weighed goods)
const DEFAULTS = {
  1: 3, 2: 1, 3: 2, 4: 2, 5: 4, 6: 1, 7: 1, 8: 1, 9: 1, 10: 4,
  11: 1, 12: 1, 13: 0, 14: 1, 15: 0.5, 16: 0.5, 17: 0.5, 18: 1, 19: 1, 20: 0.5,
  21: 2, 22: 2, 23: 2, 24: 1, 25: 1, 26: 1, 27: 1, 28: 1, 29: 1.5, 30: 1.5, 31: 2, 32: 0.5, 33: 1,
  34: 2, 35: 1, 36: 1, 37: 2, 38: 0, 39: 0, 40: 1, 41: 0, 42: 1, 43: 1, 44: 1, 45: 2, 46: 1,
  47: 1, 48: 0, 49: 0, 50: 2, 51: 2, 52: 2, 53: 2, 54: 1, 55: 1,
  56: 1, 57: 1, 58: 0, 59: 0, 60: 0,
};
const data = JSON.parse(fs.readFileSync('basket.json', 'utf8'));
data.defaults = DEFAULTS;
const json = JSON.stringify(data).replace(/<\//g, '<\/');
const html = fs.readFileSync('template.html', 'utf8').replace('/*DATA*/null', json);
fs.writeFileSync('basket-compare.html', html);
console.log('built', (html.length / 1024).toFixed(0), 'KB');
