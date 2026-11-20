// Reference view-model logic for "Trade" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { amt: 500, side: 'Buy', tab: 'Pools' };
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
const px = 169.95;
const side = this.state.side, tab = this.state.tab;
const amt = Number(this.state.amt) || 0;
const usd = side === 'Buy' ? amt : amt * px;
const fee = usd * 0.001;
const usdc = { sym: 'USDC', dot: '#2775CA' }, nv = { sym: 'NVDA', dot: '#76B900' };
const spread = 0.0015, cap = 25000, over = usd > cap;
const recv = side === 'Buy' ? ((usd - fee) / (px * (1 + spread))).toFixed(4) : (usd * (1 - spread) - fee).toFixed(2);
const sides = ['Buy', 'Sell'].map((s) => ({ label: s, on: s === side ? 'true' : 'false', bg: s === side ? '#2A2A2F' : 'transparent', fg: s === side ? '#F2F2F3' : '#8E8E96', pick: () => this.setState({ side: s, amt: s === 'Buy' ? 500 : 3, done: false }) }));
const tabs = ['Pools', 'Transactions'].map((t) => ({ label: t, on: t === tab ? 'true' : 'false', fg: t === tab ? '#F2F2F3' : '#8E8E96', line: t === tab ? '#9052F9' : 'transparent', pick: () => this.setState({ tab: t }) }));
const tx = (time, s, p, a, v, w) => ({ time: time, side: s, px: p, amt: a, value: v, wallet: w, col: s === 'Sell' ? '#FF6B6B' : '#3DD68C' });
const txs = [tx('1m ago', 'Buy', '$169.95', '2.9400', '$499.65', '0x4f2a…91c0'), tx('4m ago', 'Buy', '$169.90', '14.7100', '$2,499.23', '0x88e1…2b7d'), tx('11m ago', 'Sell', '$169.74', '5.0000', '$848.70', '0xc03b…e4a1'), tx('19m ago', 'Buy', '$169.61', '0.5900', '$100.07', '0x17d9…5f02'), tx('26m ago', 'Sell', '$169.48', '21.3000', '$3,609.92', '0x9ab4…0c3e'), tx('40m ago', 'Buy', '$169.33', '8.8600', '$1,500.26', '0x51ee…7d14')];
return {
amt: this.state.amt, onAmt: (e) => this.setState({ amt: e.target.value, done: false }),
swap: () => { if (!over) this.setState({ done: true }); }, over: over, done: !!this.state.done, doneText: 'Swapped. You received ' + recv + ' ' + (side === 'Buy' ? 'NVDA' : 'USDC') + '.',
sides: sides, tabs: tabs, txs: txs, tabPools: tab === 'Pools', tabTx: tab === 'Transactions',
pay: side === 'Buy' ? usdc : nv, get: side === 'Buy' ? nv : usdc,
recv: recv, fee: '$' + fee.toFixed(2),
cta: over ? { bg: '#1F1F23', fg: '#8E8E96', label: 'Max $25,000 per trade' } : (side === 'Buy' ? { bg: '#F2F2F3', fg: '#0B0B0D', label: 'Buy NVDA' } : { bg: '#FF6B6B', fg: '#0B0B0D', label: 'Sell NVDA' })
};
}
}
return Component; })()
