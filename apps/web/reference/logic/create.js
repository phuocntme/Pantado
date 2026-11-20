// Reference view-model logic for "Create index" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { picked: ['NVDA', 'MSFT', 'BTC.b', 'AVAX', 'WETH.e'], w: { 'NVDA': 25, 'MSFT': 25, 'BTC.b': 25, 'AVAX': 15, 'WETH.e': 10 }, f: 'All', vis: 'Private', fee: '0.25%', mode: 'Auto', drift: 50, first: 100, ticker: 'MYBK', step: 'edit' };
}
cat() {
const a = (sym, name, kind, dot, ret, vol, cap) => ({ sym: sym, name: name, kind: kind, dot: dot, ret: ret, vol: vol, cap: cap });
return [
a('NVDA', 'NVIDIA', 'Stock', '#76B900', 12.4, 48, 4100), a('MSFT', 'Microsoft', 'Stock', '#00A4EF', 4.1, 24, 3800),
a('AAPL', 'Apple', 'Stock', '#A3AAAE', 3.2, 26, 3600), a('AMD', 'AMD', 'Stock', '#B4B4BB', 9.8, 52, 390),
a('TSLA', 'Tesla', 'Stock', '#CC0000', -4.6, 61, 1300), a('AVGO', 'Broadcom', 'Stock', '#CC092F', 8.4, 44, 1600),
a('TSM', 'TSMC', 'Stock', '#B3262B', 6.1, 38, 1270), a('META', 'Meta', 'Stock', '#1877F2', 4.0, 35, 1840),
a('GOOGL', 'Alphabet', 'Stock', '#4285F4', 2.8, 29, 2300), a('AMZN', 'Amazon', 'Stock', '#FF9900', 1.7, 31, 2400),
a('MU', 'Micron', 'Stock', '#2B55A8', 10.2, 55, 140), a('MSTR', 'Strategy', 'Stock', '#D9822B', -3.9, 82, 85),
a('COIN', 'Coinbase', 'Stock', '#1652F0', 7.2, 67, 68), a('PLTR', 'Palantir', 'Stock', '#8E8E96', 12.9, 63, 430),
a('CRCL', 'Circle', 'Stock', '#3A6FF7', 15.3, 90, 28),
a('BTC.b', 'Bitcoin', 'Token', '#F7931A', 6.9, 44, 1470), a('AVAX', 'Avalanche', 'Token', '#E84142', -2.1, 72, 28),
a('WETH.e', 'Ether', 'Token', '#8C8CF7', 1.7, 58, 280), a('sAVAX', 'Staked AVAX', 'Token', '#B3292A', -1.4, 70, 4),
a('JOE', 'LFJ', 'Token', '#F2716A', -9.2, 95, 0.4)
];
}
renderVals() {
const v = this._rv();
const ini = (s) => String(s).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
const walk = (o, d) => {
if (d > 4 || !o || typeof o !== 'object') return;
if (Array.isArray(o)) { o.forEach((x) => walk(x, d + 1)); return; }
const k = o.sym || o.t || o.name;
if (typeof k === 'string' && o.ini2 === undefined) o.ini2 = ini(k);
Object.keys(o).forEach((key) => { const x = o[key]; if (x && typeof x === 'object') walk(x, d + 1); });
};
walk(v, 0);
return v;
}
_rv() {
const cat = this.cat();
const picked = this.state.picked, w = this.state.w, f = this.state.f;
const setW = (sym, val) => this.setState({ w: Object.assign({}, this.state.w, { [sym]: Number(val) }) });
const toggle = (sym) => {
if (picked.indexOf(sym) >= 0) { this.setState({ picked: picked.filter((s) => s !== sym) }); }
else if (picked.length < 20) { this.setState({ picked: picked.concat([sym]), w: Object.assign({}, w, { [sym]: w[sym] || 0 }) }); }
};
const catalog = cat.filter((c) => f === 'All' || (f === 'Stocks' && c.kind === 'Stock') || (f === 'Tokens' && c.kind === 'Token')).map((c) => {
const on = picked.indexOf(c.sym) >= 0;
return Object.assign({}, c, { on: on ? 'true' : 'false', btn: on ? 'Added' : 'Add', bg: on ? '#1F1F23' : '#F2F2F3', fg: on ? '#B4B4BB' : '#0B0B0D', toggle: () => toggle(c.sym) });
});
const sel = cat.filter((c) => picked.indexOf(c.sym) >= 0);
const basket = sel.map((c) => ({ sym: c.sym, kind: c.kind, dot: c.dot, w: w[c.sym] || 0, label: 'Weight of ' + c.sym, rmLabel: 'Remove ' + c.sym, set: (e) => setW(c.sym, e.target.value), remove: () => toggle(c.sym) }));
const total = basket.reduce((s, b) => s + b.w, 0);
const spread = (scores) => {
const sum = scores.reduce((s, x) => s + x, 0) || 1;
const raw = scores.map((x) => Math.floor(x / sum * 100));
let left = 100 - raw.reduce((s, x) => s + x, 0);
for (let i = 0; left > 0 && raw.length; i = (i + 1) % raw.length) { raw[i] += 1; left -= 1; }
const out = {}; sel.forEach((c, i) => { out[c.sym] = raw[i]; }); return out;
};
const capped = (xs, cap) => {
let w = xs.map((x) => x / xs.reduce((s, y) => s + y, 0));
for (let k = 0; k < 10; k++) {
const over = w.map((x) => x > cap), extra = w.reduce((s, x, i) => s + (over[i] ? x - cap : 0), 0);
if (extra < 1e-9) break;
const room = w.reduce((s, x, i) => s + (over[i] ? 0 : x), 0);
w = w.map((x, i) => over[i] ? cap : x + extra * x / room);
}
return w;
};
const presets = [
{ label: 'Equal', pick: () => this.setState({ w: Object.assign({}, w, spread(sel.map(() => 1))) }) },
{ label: 'Market cap', pick: () => this.setState({ w: Object.assign({}, w, spread(capped(sel.map((c) => c.cap), 0.4))) }) },
{ label: 'Low volatility', pick: () => this.setState({ w: Object.assign({}, w, spread(sel.map((c) => 1 / c.vol))) }) }
];
const t = total || 1;
const ret = sel.reduce((s, c) => s + (w[c.sym] || 0) * c.ret, 0) / t;
const vol = Math.sqrt(sel.reduce((s, c) => s + Math.pow((w[c.sym] || 0) / t * c.vol, 2), 0)) * 1.6;
const stocks = sel.filter((c) => c.kind === 'Stock').reduce((s, c) => s + (w[c.sym] || 0), 0);
const first = Number(this.state.first) || 0;
const ok = total === 100 && sel.length >= 2 && first >= 100 && (this.state.ticker || '').length >= 2 && basket.every((b) => b.w >= 1);
const isPublic = this.state.vis === 'Public';
const chips = ['All', 'Stocks', 'Tokens'].map((c) => ({ label: c, on: c === f ? 'true' : 'false', bg: c === f ? '#F2F2F3' : '#1A1A1D', fg: c === f ? '#0B0B0D' : '#B4B4BB', pick: () => this.setState({ f: c }) }));
const vis = ['Private', 'Public'].map((v) => ({ label: v, on: v === this.state.vis ? 'true' : 'false', bg: v === this.state.vis ? '#2A2A2F' : 'transparent', fg: v === this.state.vis ? '#F2F2F3' : '#8E8E96', pick: () => this.setState({ vis: v }) }));
return {
chips: chips, catalog: catalog, basket: basket, presets: presets, vis: vis, isPublic: isPublic,
segs: basket.map((b) => ({ w: b.w, dot: b.dot })),
total: total, totalCol: total === 100 ? '#3DD68C' : '#F5B14C',
mixText: total ? 'Stocks ' + Math.round(stocks / t * 100) + '% · Tokens ' + (100 - Math.round(stocks / t * 100)) + '%' : 'Add assets to start',
ret: (ret >= 0 ? '+' : '') + ret.toFixed(1) + '%', retCol: ret >= 0 ? '#3DD68C' : '#FF6B6B',
vol: vol.toFixed(0) + '%', dd: '-' + (vol * 0.55).toFixed(1) + '%', slip: (0.12 + sel.length * 0.03).toFixed(2) + '%',
disabled: ok ? 'false' : 'true', created: this.state.step === 'done', reviewing: this.state.step === 'review', createdText: (isPublic ? 'Published ' : 'Created ') + (this.state.ticker || '').toUpperCase() + '. You hold ' + ((first * 0.995) / 100).toFixed(2) + ' units.',
createdSub: isPublic ? 'It is listed in the Marketplace. You earn 0.20% of every buy and sell.' : 'Private: it is not listed in the Marketplace. Only you see it, in Portfolio › Your indexes. You can make it public later.',
visLabel: isPublic ? 'Public' : 'Private', modeSummary: this.state.mode === 'Auto' ? 'Auto at ' + this.state.drift + '% drift' : this.state.mode, firstS: first.toFixed(2) + ' USDC', tradeFee: (first * 0.005).toFixed(2) + ' USDC', payS: (first + 5).toFixed(2) + ' USDC', unitsS: ((first * 0.995) / 100).toFixed(2) + ' ' + (this.state.ticker || '').toUpperCase() + ' at level 100',
ticker: this.state.ticker, onTicker: (e) => this.setState({ ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) }),
back: () => this.setState({ step: 'edit' }), confirm: () => this.setState({ step: 'done' }),
create: () => { if (ok) { this.setState({ step: 'review' }); try { window.scrollTo(0, 0); } catch (e) {} } },
cta: ok ? { bg: '#F2F2F3', fg: '#0B0B0D', label: 'Review: ' + (isPublic ? 'publish' : 'create') + ' and buy' } : { bg: '#1F1F23', fg: '#8E8E96', label: total !== 100 ? 'Weights must total 100%' : (sel.length < 2 ? 'Add at least 2 assets' : (basket.some((b) => b.w < 1) ? 'Every asset needs at least 1%' : ((this.state.ticker || '').length < 2 ? 'Add a ticker' : 'First buy is at least 100 USDC'))) },
modes: ['Off', 'Manual', 'Auto'].map((m) => ({ label: m, on: m === this.state.mode ? 'true' : 'false', bg: m === this.state.mode ? '#2A2A2F' : 'transparent', fg: m === this.state.mode ? '#F2F2F3' : '#8E8E96', pick: () => this.setState({ mode: m }) })),
modeText: { Off: 'Weights move with prices. The basket never changes.', Manual: 'You publish new weights. Holders get 48h notice.', Auto: 'Rebalances itself when an asset drifts too far.' }[this.state.mode],
isAuto: this.state.mode === 'Auto', drift: this.state.drift, onDrift: (e) => this.setState({ drift: Number(e.target.value) }),
driftEx: 'A 20% target triggers below ' + (20 * (1 - this.state.drift / 100)).toFixed(0) + '% or above ' + (20 * (1 + this.state.drift / 100)).toFixed(0) + '%.',
first: this.state.first, onFirst: (e) => this.setState({ first: e.target.value })
};
}
}
return Component; })()
