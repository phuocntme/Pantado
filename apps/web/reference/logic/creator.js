// Reference view-model logic for "Creator" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { copied: false };
}
renderVals() {
const ix = (name, stocks, level, m, holders, created) => ({ name: name, stocks: stocks, mixLabel: stocks + ' percent stocks, ' + (100 - stocks) + ' percent tokens', level: level, m: m, mCol: m.charAt(0) === '-' ? '#FF6B6B' : '#3DD68C', holders: holders, created: created });
const list = [
ix('Avalanche Blue Chips', 0, '121.40', '+6.7%', '3,518', 'Aug 2026'),
ix('Crypto Beta', 35, '118.75', '+8.9%', '2,076', 'Sep 2026'),
ix('Tech + BTC Balanced', 50, '107.02', '+5.6%', '1,204', 'Aug 2026')
];
return { list: list, copyLabel: this.state.copied ? 'Copied' : 'Copy', copy: () => { try { navigator.clipboard.writeText('0x2c71…ab90'); } catch (e) {} this.setState({ copied: true }); } };
}
}
return Component; })()
