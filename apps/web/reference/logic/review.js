// Reference view-model logic for "Review" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { amt: 1000, side: 'Buy', tab: 'Composition', step: 'review' };
}
extra() {
const tab = this.state.tab;
const tabs = ['Composition', 'Transactions', 'Rebalances', 'Holders'].map((t) => ({ label: t, on: t === tab ? 'true' : 'false', fg: t === tab ? '#F2F2F3' : '#8E8E96', line: t === tab ? '#9052F9' : 'transparent', pick: () => this.setState({ tab: t }) }));
const tx = (time, type, value, units, wallet) => ({ time: time, type: type, value: value, units: units, wallet: wallet, col: type === 'Sell' ? '#FF6B6B' : (type === 'Buy' ? '#3DD68C' : '#F5B14C') });
const txs = [tx('2m ago', 'Buy', '$1,250.00', '11.68', '0x4f2a…91c0'), tx('9m ago', 'Buy', '$50.00', '0.47', '0x88e1…2b7d'), tx('31m ago', 'Sell', '$3,402.18', '31.79', '0xc03b…e4a1'), tx('1h ago', 'Buy', '$500.00', '4.67', '0x17d9…5f02'), tx('3h ago', 'Rebalance', '$18,240.00', '—', 'Router'), tx('5h ago', 'Buy', '$2,000.00', '18.69', '0x9ab4…0c3e')];
const ver = (name, date, change, reason, status) => ({ name: name, date: date, change: change, reason: reason, status: status, pillBg: status === 'Scheduled' ? '#2E2311' : (status === 'Live' ? '#11261B' : '#1F1F23'), pillFg: status === 'Scheduled' ? '#F5B14C' : (status === 'Live' ? '#3DD68C' : '#B4B4BB') });
const versions = [ver('Version 4', 'Nov 13', 'NVDA 25 → 30% · AVAX 15 → 10%', 'AVAX pool depth fell 40% this month', 'Scheduled'), ver('Version 3', 'Oct 14', 'BTC.b 20 → 25% · AMD removed', 'Monthly rebalance', 'Live'), ver('Version 2', 'Sep 14', 'WETH.e added at 10%', 'Lower single-asset risk', 'Past'), ver('Version 1', 'Aug 12', 'Created with 5 assets', 'Launch', 'Past')];
const hold = (wallet, units, value, share, creator) => ({ wallet: wallet, units: units, value: value, share: share, creator: creator });
const holders = [hold('0x2c71…ab90', '1,840.2', '$196,938', '8.2%', true), hold('0x9ab4…0c3e', '1,102.7', '$118,011', '4.9%', false), hold('0x4f2a…91c0', '868.0', '$92,893', '3.9%', false), hold('0x51ee…7d14', '640.5', '$68,546', '2.9%', false), hold('0xc03b…e4a1', '402.3', '$43,054', '1.8%', false), hold('0x77a0…19bf', '318.9', '$34,129', '1.4%', false)];
return { tabs: tabs, txs: txs, versions: versions, holders: holders, tabComp: tab === 'Composition', tabTx: tab === 'Transactions', tabReb: tab === 'Rebalances', tabHold: tab === 'Holders' };
}
review() {
const step = this.state.step;
const net = 995;
const raw = [['NVDA', 25, 169.95, 'Stock venue · reference price'], ['MSFT', 25, 512.40, 'Stock venue · reference price'], ['BTC.b', 25, 74357, 'Token venue'], ['AVAX', 15, 6.51, 'Token venue'], ['WETH.e', 10, 2318, 'Token venue']];
const dp = (px) => (px > 1000 ? 6 : 4);
const legsR = raw.map((r) => { const q = net * r[1] / 100 / r[2]; return { t: r[0], w: r[1], route: r[3], got: q.toFixed(dp(r[2])) + ' ' + r[0], min: (q * 0.995).toFixed(dp(r[2])) }; });
return { legsR: legsR, isReview: step === 'review', isSigning: step === 'signing', isDone: step === 'done', toSign: () => this.setState({ step: 'signing' }), toDone: () => this.setState({ step: 'done' }) };
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
return Object.assign(this.base(), this.extra(), this.review());
}
base() {
const up = '#3DD68C', down = '#FF6B6B';
const col = (s) => (s.charAt(0) === '-' ? down : up);
const amt = Number(this.state.amt) || 0;
const side = this.state.side;
const rows = [
{ t: 'NVDA', kind: 'Stock', w: 25, px: '$169.95', d: '+3.1%', m: '+11.1%', liq: '$4.1M', c: '#F2F2F3' },
{ t: 'MSFT', kind: 'Stock', w: 25, px: '$512.40', d: '-0.4%', m: '+1.2%', liq: '$3.3M', c: '#B4B4BB' },
{ t: 'BTC.b', kind: 'Token', w: 25, px: '$74,357', d: '+0.7%', m: '+3.8%', liq: '$18.6M', c: '#9052F9' },
{ t: 'AVAX', kind: 'Token', w: 15, px: '$6.51', d: '+2.1%', m: '-2.1%', liq: '$42.0M', c: '#6A3CC9' },
{ t: 'WETH.e', kind: 'Token', w: 10, px: '$2,318', d: '-1.1%', m: '+0.9%', liq: '$9.8M', c: '#46288A' }
].map((r) => Object.assign(r, { dCol: col(r.d), mCol: col(r.m) }));
const level = 107.02;
const usd = side === 'Buy' ? amt : amt * level;
const feeAmt = usd * 0.005;
const net = usd - feeAmt;
const money = (x) => '$' + x.toFixed(2);
const sides = ['Buy', 'Sell'].map((s) => ({ label: s, on: s === side ? 'true' : 'false', bg: s === side ? '#2A2A2F' : 'transparent', fg: s === side ? '#F2F2F3' : '#8E8E96', pick: () => this.setState({ side: s }) }));
return {
amt: this.state.amt, onAmt: (e) => this.setState({ amt: e.target.value }),
unit: side === 'Buy' ? 'USDC' : 'TBB', sides: sides,
recv: side === 'Buy' ? (net / level).toFixed(2) : net.toFixed(2), getSym: side === 'Buy' ? 'TBB' : 'USDC', tokStocks: side === 'Buy' ? 50 : 0, tokRight: side === 'Buy' ? '#9052F9' : '#2775CA',
rows: rows, legs: rows.map((r) => ({ t: r.t, c: r.c, w: r.w, usd: money(net * r.w / 100) })),
fee: money(feeAmt),
cta: side === 'Buy' ? { bg: '#F2F2F3', label: 'Buy index' } : { bg: '#FF6B6B', label: 'Sell for ' + money(net) }
};
}
}
return Component; })()
