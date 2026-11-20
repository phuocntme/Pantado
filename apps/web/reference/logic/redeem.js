// Reference view-model logic for "Redeem" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { fixed: [], step: 'review' };
}
renderVals() {
const v = this._rv();
v.isReview = this.state.step === 'review'; v.isDone = this.state.step === 'done'; v.toDone = () => this.setState({ step: 'done' });
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
const fixed = this.state.fixed;
const pos = [
{ id: 'a', name: 'Tech + BTC Balanced', units: '38.2 TBB', value: '$4,088.16', pnl: '+$281.90', drift: 1.8 },
{ id: 'b', name: 'Avalanche Blue Chips', units: '21.0 ABC', value: '$2,549.40', pnl: '+$412.75', drift: 6.4 },
{ id: 'c', name: 'S&P Leaders Ten', units: '16.5 SPL10', value: '$1,714.02', pnl: '-$22.31', drift: 2.9 }
].map((p) => {
const d = fixed.indexOf(p.id) >= 0 ? 0.3 : p.drift;
const needs = d > 5;
return Object.assign({}, p, {
drift: needs ? d.toFixed(1) + '% drift · rebalance scheduled' : (d < 1 ? 'On target' : d.toFixed(1) + '% drift'),
needs: needs, ok: !needs,
pillBg: needs ? '#2E2311' : '#11261B', pillFg: needs ? '#F5B14C' : '#3DD68C',
pnlCol: p.pnl.charAt(0) === '-' ? down : up,
fix: () => this.setState({ fixed: fixed.concat([p.id]) })
});
});
const mine = [
{ name: 'Chips and Chains', units: 'You hold 12.4 CC', mode: 'Auto · 50% drift', holders: '267', earned: '$118.40', status: 'Public', pillBg: '#1F1F23', pillFg: '#F2F2F3', href: 'IndexDetail.dc.html', manual: false },
{ name: 'AVAX Yield Mix', units: 'You hold 8.0 AYM', mode: 'Manual', holders: '12', earned: '$23.70', status: 'Public', pillBg: '#1F1F23', pillFg: '#F2F2F3', href: 'IndexDetail.dc.html', manual: true },
{ name: 'My basket', units: 'You hold 2.40 MYBK', mode: 'Manual', holders: 'Only you', earned: '—', status: 'Private', pillBg: '#221637', pillFg: '#C9B3FD', href: 'IndexPrivate.dc.html', manual: true },
{ name: 'Weekend Hedge', units: 'You hold 5.10 WKH', mode: 'Auto · 30% drift', holders: 'Only you', earned: '—', status: 'Private', pillBg: '#221637', pillFg: '#C9B3FD', href: 'IndexPrivate.dc.html', manual: false }
];
const raw = [['USDC', 'Cash', 1620.40, '1,620.40', '0.0%', '#2775CA'], ['AVAX', 'Token', 1188.08, '182.5', '+2.1%', '#E84142'], ['NVDA', 'Stock', 713.79, '4.2', '+3.1%', '#76B900'], ['BTC.b', 'Token', 527.93, '0.0071', '+0.7%', '#F7931A'], ['TSLA', 'Stock', 361.96, '0.9', '-2.4%', '#CC0000']];
const tot = raw.reduce((x, r) => x + r[2], 0);
let acc = 0;
const assets = raw.map((r) => { const p = r[2] / tot * 100; const dash = p.toFixed(2) + ' ' + (100 - p).toFixed(2); const before = acc; acc += p;
return { sym: r[0], kind: r[1], amt: r[3], value: '$' + r[2].toLocaleString('en-US', { minimumFractionDigits: 2 }), d: r[4], dot: r[5], dCol: r[4].charAt(0) === '-' ? down : (r[4] === '0.0%' ? '#8E8E96' : up), pct: p.toFixed(1) + '%', pctW: p.toFixed(1) + '%', dash: dash, off: String(((100 - before) % 100).toFixed(2)) }; });
const share = (k) => raw.filter((r) => r[1] === k).reduce((x, r) => x + r[2], 0) / tot * 100;
const split = [['Stocks', '#76B900', share('Stock')], ['Tokens', '#E84142', share('Token')], ['Cash', '#2775CA', share('Cash')]].map((x) => ({ label: x[0], col: x[1], pct: x[2].toFixed(1) + '%' }));
return { pos: pos, mine: mine, assets: assets, split: split, walletTotal: '$' + tot.toLocaleString('en-US', { minimumFractionDigits: 2 }), walletDay: '+$41.18' };
}
}
return Component; })()
