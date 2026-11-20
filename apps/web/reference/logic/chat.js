// Reference view-model logic for "Ask" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { conv: 'asset', sel: 1 };
}
renderVals() {
const go = (id) => () => this.setState({ conv: id });
const data = [
{ id: 'asset', title: 'NVDA today', q: 'How is NVDA doing today?', meta: '3 tools · 1.8s', related: [['Why is NVDA up this month?', 'asset'], ['Build me a chip basket around NVDA', 'rec'], ['Which indexes hold NVDA?', 'index']] },
{ id: 'rec', title: 'Tech plus crypto, low swings', q: 'US tech plus crypto in one basket, with smaller swings.', meta: '4 tools · 3.2s', related: [['Cap any single asset at 20%', 'rec'], ['How often should this rebalance?', 'general'], ['Is there an index like this already?', 'index']] },
{ id: 'general', title: 'What is rebalancing?', q: 'What is rebalancing, and why do indexes do it?', meta: 'No tools needed', related: [['What does drift mean?', 'general'], ['How is an index level calculated?', 'general'], ['Show me an index that rebalances monthly', 'index']] },
{ id: 'index', title: 'Is Blue Chips worth holding?', q: 'Is Avalanche Blue Chips worth holding?', meta: '3 tools · 2.4s', related: [['AVAX or sAVAX for a long hold?', 'compare'], ['Find a lower-volatility alternative', 'rec'], ['What is rebalancing?', 'general']] },
{ id: 'compare', title: 'AVAX or sAVAX?', q: 'AVAX or sAVAX for a long hold?', meta: '2 tools · 2.1s', related: [['How does staking yield reach sAVAX holders?', 'general'], ['Is Avalanche Blue Chips worth holding?', 'index'], ['How is NVDA doing today?', 'asset']] }
];
const conv = this.state.conv;
const c = data.find((d) => d.id === conv);
const convs = data.map((d) => ({ title: d.title, on: d.id === conv ? 'true' : 'false', bg: d.id === conv ? '#1F1F23' : 'transparent', fg: d.id === conv ? '#F2F2F3' : '#B4B4BB', pick: go(d.id) }));
const mk = (t, w, stock) => ({ t: t, w: w, bar: w * 3, c: stock ? '#F2F2F3' : '#9052F9' });
const list = [
{ name: 'Conservative', stocks: 70, ret: '+1.3%', vol: '18%', dd: '-9.4%', slip: '0.21%', assets: [mk('MSFT', 30, 1), mk('NVDA', 25, 1), mk('AMD', 15, 1), mk('BTC.b', 20, 0), mk('AVAX', 10, 0)] },
{ name: 'Balanced', stocks: 50, ret: '+11.2%', vol: '27%', dd: '-14.1%', slip: '0.24%', assets: [mk('NVDA', 25, 1), mk('MSFT', 25, 1), mk('BTC.b', 25, 0), mk('AVAX', 15, 0), mk('WETH.e', 10, 0)] },
{ name: 'Aggressive', stocks: 25, ret: '-9.4%', vol: '41%', dd: '-23.7%', slip: '0.33%', assets: [mk('AVAX', 30, 0), mk('BTC.b', 25, 0), mk('WETH.e', 20, 0), mk('NVDA', 15, 1), mk('AMD', 10, 1)] }
];
const sel = this.state.sel;
const opts = list.map((p, i) => ({
name: p.name, ret: p.ret, stocks: p.stocks, mix: p.stocks + '% stocks · ' + (100 - p.stocks) + '% tokens',
on: i === sel ? 'true' : 'false', bg: i === sel ? '#1A1A1D' : 'transparent', border: i === sel ? '#F2F2F3' : '#26262B',
pick: () => this.setState({ sel: i })
}));
return {
convs: convs, title: c.title, q: c.q, meta: c.meta,
related: c.related.map((r) => ({ text: r[0], pick: go(r[1]) })),
isAsset: conv === 'asset', isRec: conv === 'rec', isGeneral: conv === 'general', isIndex: conv === 'index', isCompare: conv === 'compare',
opts: opts, cur: list[sel], sel0: sel === 0, sel1: sel === 1, sel2: sel === 2
};
}
}
return Component; })()
