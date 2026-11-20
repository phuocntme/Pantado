// Reference view-model logic for "Marketplace" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { f: 'All' };
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
const up = '#3DD68C', down = '#FF6B6B';
const col = (s) => (s.charAt(0) === '-' ? down : up);
const vol = (v) => '$' + (v >= 1 ? v.toFixed(1) + 'M' : Math.round(v * 1000) + 'K');
const base = (o) => Object.assign(o, { dCol: col(o.d), wCol: col(o.w), mCol: col(o.m), volS: vol(o.vol) });
const ix = (name, creator, stocks, level, d, w, m, v) => base({ type: 'Index', isIndex: true, isAsset: false, name: name, sub: 'by ' + creator, stocks: stocks, price: level, d: d, w: w, m: m, vol: v, href: 'IndexDetail.dc.html', cta: 'Buy', typeBg: '#221637', typeFg: '#C9B3FD', src: 'Fuji', srcDot: '#F5B14C' });
const as = (type, sym, name, px, d, w, m, v, dot) => base({ type: type, isIndex: false, isAsset: true, name: sym, sub: name, dot: dot, src: type === 'Stock' ? 'Robinhood Chain' : 'Avalanche', srcDot: type === 'Stock' ? '#6FA8FF' : '#E84142', price: px, d: d, w: w, m: m, vol: v, href: 'Asset.dc.html', cta: 'Swap', typeBg: '#1F1F23', typeFg: '#B4B4BB' });
const all = [
as('Token', 'AVAX', 'Avalanche', '$6.51', '+2.1%', '+4.8%', '-2.1%', 84.2, '#E84142'),
as('Token', 'BTC.b', 'Bitcoin', '$74,357', '+0.7%', '+2.2%', '+3.8%', 31.5, '#F7931A'),
as('Token', 'WETH.e', 'Ether', '$2,318', '-1.1%', '+0.6%', '+0.9%', 22.9, '#8C8CF7'),
as('Stock', 'NVDA', 'NVIDIA', '$169.95', '+3.1%', '-0.2%', '+11.1%', 12.9, '#76B900'),
as('Token', 'sAVAX', 'Staked AVAX', '$7.84', '+1.9%', '+4.5%', '-1.4%', 9.4, '#B3292A'),
as('Stock', 'TSLA', 'Tesla', '$402.18', '-2.4%', '-3.9%', '-4.6%', 8.7, '#CC0000'),
as('Stock', 'MSFT', 'Microsoft', '$512.40', '-0.4%', '+0.8%', '+1.2%', 6.1, '#00A4EF'),
as('Stock', 'AAPL', 'Apple', '$271.06', '+0.5%', '+1.1%', '+3.2%', 5.8, '#A3AAAE'),
as('Stock', 'AVGO', 'Broadcom', '$342.10', '+1.9%', '+2.7%', '+8.4%', 4.9, '#CC092F'),
as('Stock', 'AMD', 'AMD', '$158.40', '+2.6%', '+1.4%', '+9.8%', 4.6, '#7A7A82'),
as('Stock', 'META', 'Meta', '$731.20', '-0.8%', '+1.9%', '+4.0%', 4.2, '#1877F2'),
as('Stock', 'TSM', 'TSMC', '$244.75', '+1.2%', '+2.0%', '+6.1%', 3.9, '#B3262B'),
as('Stock', 'GOOGL', 'Alphabet', '$189.30', '+0.3%', '-0.5%', '+2.8%', 3.6, '#4285F4'),
as('Stock', 'AMZN', 'Amazon', '$228.60', '-0.6%', '+0.9%', '+1.7%', 3.3, '#FF9900'),
as('Stock', 'MSTR', 'Strategy', '$312.40', '+4.6%', '+6.2%', '-3.9%', 2.9, '#D9822B'),
as('Stock', 'COIN', 'Coinbase', '$268.90', '+3.3%', '+5.1%', '+7.2%', 2.4, '#1652F0'),
as('Stock', 'PLTR', 'Palantir', '$182.15', '+1.1%', '+3.6%', '+12.9%', 2.1, '#8E8E96'),
as('Stock', 'CRCL', 'Circle', '$121.75', '-0.7%', '+2.2%', '+15.3%', 1.8, '#3A6FF7'),
ix('Avalanche Blue Chips', '@handle', 0, '121.40', '+2.1%', '+8.3%', '+6.7%', 0.62),
ix('Crypto Beta', '@handle', 35, '118.75', '+0.9%', '+4.4%', '+8.9%', 0.31),
ix('Tech + BTC Balanced', '@handle', 50, '107.02', '+1.3%', '+9.3%', '+5.6%', 0.18),
ix('S&P Leaders Ten', '0x91f0…3c7a', 100, '103.88', '-0.2%', '+0.6%', '+2.3%', 0.074),
ix('Chips and Chains', '0x7a3f…c21e', 50, '109.12', '+1.8%', '+3.1%', '+5.2%', 0.021),
ix('Low Swing Mix', '0x19bd…04aa', 80, '99.21', '-0.1%', '+0.4%', '-0.8%', 0.009)
];
const f = this.state.f;
const kind = { All: null, Indexes: 'Index', Stocks: 'Stock', Tokens: 'Token' };
const rows = all.filter((r) => !kind[f] || r.type === kind[f]).sort((a, b) => b.vol - a.vol).map((r, i) => Object.assign({}, r, { rank: i + 1 }));
const chips = ['All', 'Indexes', 'Stocks', 'Tokens'].map((c) => ({ label: c, n: all.filter((r) => !kind[c] || r.type === kind[c]).length, on: c === f ? 'true' : 'false', bg: c === f ? '#F2F2F3' : '#1A1A1D', fg: c === f ? '#0B0B0D' : '#B4B4BB', pick: () => this.setState({ f: c }) }));
return { chips: chips, rows: rows };
}
}
return Component; })()
