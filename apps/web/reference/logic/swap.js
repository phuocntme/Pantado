// Reference view-model logic for "Swap" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) { super(props); this.state = { from: 'USDC', to: 'NVDA', amt: 1000, done: false, pick: null, q: '' }; }
renderVals() {
const A = { USDC: [1, '#2775CA', 'USD Coin', '0x5425…1965'], AVAX: [6.51, '#E84142', 'Avalanche', 'Native'], 'BTC.b': [74357, '#F7931A', 'Bitcoin', '0x152b…f3c4'], 'WETH.e': [2318, '#8C8CF7', 'Ether', '0x49d5…cbab'], sAVAX: [7.84, '#B3292A', 'Staked AVAX', '0x2b2c…7be'], JOE: [0.21, '#F2716A', 'LFJ', '0x6e84…6bd'],
  NVDA: [169.95, '#76B900', 'NVIDIA', '0x8a1f…c210'], MSFT: [512.40, '#00A4EF', 'Microsoft', '0x3c7e…09a4'], AAPL: [271.06, '#A3AAAE', 'Apple', '0x91b2…77de'], TSLA: [402.18, '#CC0000', 'Tesla', '0x0f4d…a913'], AVGO: [342.10, '#CC092F', 'Broadcom', '0x6d20…5be1'], AMD: [158.40, '#7A7A82', 'AMD', '0xa7c3…1e02'],
  META: [731.20, '#1877F2', 'Meta', '0x24e9…c6f7'], TSM: [244.75, '#B3262B', 'TSMC', '0xd18a…34b0'], GOOGL: [189.30, '#4285F4', 'Alphabet', '0x5f6b…e8a1'], AMZN: [228.60, '#FF9900', 'Amazon', '0xbe02…7c5d'], COIN: [268.90, '#1652F0', 'Coinbase', '0x7731…aa90'], MSTR: [312.40, '#D9822B', 'Strategy', '0x4cd8…02f6'] };
const ini = (s) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
const st = this.state; const f = A[st.from], t = A[st.to];
const amt = Number(st.amt) || 0; const usd = amt * f[0];
const stock = ['NVDA','MSFT','AAPL','TSLA','AVGO','AMD','META','TSM','GOOGL','AMZN','COIN','MSTR'].indexOf(st.from) >= 0 || ['NVDA','MSFT','AAPL','TSLA','AVGO','AMD','META','TSM','GOOGL','AMZN','COIN','MSTR'].indexOf(st.to) >= 0;
const fee = usd * 0.001; const recv = (usd - fee - usd * (stock ? 0.0015 : 0.0006)) / t[0];
const fmt = (n) => n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toFixed(n < 1 ? 6 : 4);
const usdS = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q = st.q.trim().toLowerCase(); const isAddr = q.indexOf('0x') === 0;
const results = Object.keys(A).filter((s) => s !== (st.pick === 'from' ? st.to : st.from)).filter((s) => !q || s.toLowerCase().indexOf(q) >= 0 || A[s][2].toLowerCase().indexOf(q) >= 0 || A[s][3].toLowerCase().indexOf(q) === 0)
  .map((s) => ({ sym: s, ini: ini(s), dot: A[s][1], name: A[s][2], addr: A[s][3], px: A[s][0] >= 1000 ? '$' + A[s][0].toLocaleString('en-US') : '$' + A[s][0].toFixed(2), pick: () => this.setState(st.pick === 'from' ? { from: s, pick: null, q: '', done: false } : { to: s, pick: null, q: '', done: false }) }));
return { swapping: !st.pick, picking: !!st.pick, pickTitle: st.pick === 'from' ? 'You pay with' : 'You receive', q: st.q, onQ: (e) => this.setState({ q: e.target.value }), close: () => this.setState({ pick: null, q: '' }),
  results: results, none: results.length === 0, noneText: isAddr ? 'No listed asset at this contract address. Pantado only trades assets in its registry.' : 'No stock or token matches “' + st.q + '”.',
  amt: st.amt, onAmt: (e) => this.setState({ amt: e.target.value, done: false }),
  from: { sym: st.from, ini: ini(st.from), dot: f[1], open: () => this.setState({ pick: 'from' }) }, to: { sym: st.to, ini: ini(st.to), dot: t[1], open: () => this.setState({ pick: 'to' }) },
  fromUsd: usdS(usd), recv: recv > 0 ? fmt(recv) : '0', rate: '1 ' + st.to + ' = ' + fmt(t[0] / f[0]) + ' ' + st.from,
  route: stock ? 'Pantado stock venue' : 'Pantado token venue', fee: usdS(fee),
  flip: () => this.setState({ from: st.to, to: st.from, done: false }), go: () => this.setState({ done: true }), done: st.done };
}
}
return Component; })()
