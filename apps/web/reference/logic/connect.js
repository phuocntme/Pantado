// Reference view-model logic for "Connect" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { tab: 'Today', mode: 'Auto' };
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
const q = (text) => ({ chip: false, text: text, buy: false, ask: true, weight: 400 });
const a = (sym, nm, dot, text) => ({ chip: true, sym: sym, nm: nm, dot: dot, text: text, buy: false, ask: true, weight: 400 });
const b = (text) => ({ chip: false, text: text, buy: true, ask: false, weight: 600 });
const sets = {
Today: [b('Buy Tech + BTC Balanced for $50'), a('NVDA', 'NVIDIA', '#76B900', 'is up 3.1% today on Avalanche. What is moving it?'), q('Which indexes gained the most holders this week?'), a('AVAX', 'Avalanche', '#E84142', 'traded $84M on DEXs today. Who are the biggest buyers?'), q('Build a low-volatility basket of five assets.')],
Indexes: [b('Buy Avalanche Blue Chips for $50'), q('Top five indexes by 30-day return, with drawdown.'), q('Compare Tech + BTC Balanced with holding AVAX.'), q('Which listed indexes rebalanced this week, and why?'), q('Turn my wallet into an index I can share.')],
Stocks: [b('Buy S&P Leaders Ten for $50'), a('MSFT', 'Microsoft', '#00A4EF', 'reports earnings this week. How did it trade after the last four?'), a('AMD', 'Advanced Micro Devices', '#B4B4BB', 'or NVDA for a chip basket? Compare liquidity on Avalanche.'), q('Which stock tokens have the deepest pools right now?'), q('Equal-weight the seven largest US tech stocks.')],
Tokens: [b('Buy Avalanche Blue Chips for $50'), a('BTC.b', 'Bitcoin', '#F7931A', 'is up 0.7% today. Trend, support and resistance?'), a('sAVAX', 'Staked AVAX', '#E84142', 'versus AVAX in a basket: what changes?'), q('Which Avalanche tokens gained liquidity this week?'), q('Weight the top ten Avalanche tokens by market cap, cap each at 20%.')]
};
const tab = this.state.tab, mode = this.state.mode;
const tabs = ['Today', 'Indexes', 'Stocks', 'Tokens'].map((t) => ({ label: t, on: t === tab ? 'true' : 'false', bg: t === tab ? '#F2F2F3' : '#1A1A1D', fg: t === tab ? '#0B0B0D' : '#B4B4BB', pick: () => this.setState({ tab: t }) }));
const modes = ['Auto', 'Deep'].map((m) => ({ label: m, on: m === mode ? 'true' : 'false', bg: m === mode ? '#F2F2F3' : 'transparent', fg: m === mode ? '#0B0B0D' : '#B4B4BB', pick: () => this.setState({ mode: m }) }));
return { tabs: tabs, modes: modes, rows: sets[tab] };
}
}
return Component; })()
