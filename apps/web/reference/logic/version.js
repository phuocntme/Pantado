// Reference view-model logic for "New version" (extracted, for porting only).
(function () {
class Component extends DCLogic {
constructor(props) {
super(props);
this.state = { w: { NVDA: 30, MSFT: 25, 'BTC.b': 25, AVAX: 10, 'WETH.e': 10 }, when: '48h', done: false };
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
const base = [['NVDA', 25, '#F2F2F3', 48], ['MSFT', 25, '#B4B4BB', 24], ['BTC.b', 25, '#9052F9', 44], ['AVAX', 15, '#6A3CC9', 72], ['WETH.e', 10, '#46288A', 58]];
const w = this.state.w;
const rows = base.map((b) => {
const d = w[b[0]] - b[1];
return { t: b[0], old: b[1], w: w[b[0]], c: b[2], label: 'Version 4 weight of ' + b[0], delta: d === 0 ? '—' : (d > 0 ? '+' : '') + d,
dCol: d > 0 ? '#3DD68C' : (d < 0 ? '#FF6B6B' : '#8E8E96'),
set: (e) => this.setState({ w: Object.assign({}, w, { [b[0]]: Number(e.target.value) }), done: false }) };
});
const total = rows.reduce((s, r) => s + r.w, 0);
const turnover = rows.reduce((s, r) => s + Math.abs(r.w - r.old), 0) / 2;
const volOf = (get) => Math.sqrt(base.reduce((s, b) => s + Math.pow(get(b) / 100 * b[3], 2), 0));
const vol = volOf((b) => w[b[0]]) / volOf((b) => b[1]) * 27;
const changed = rows.filter((r) => r.w !== r.old).map((r) => r.t + ' ' + r.old + ' → ' + r.w + '%');
const ok = total === 100 && changed.length > 0;
const when = this.state.when;
const whens = ['48h', '72h', '7 days'].map((x) => ({ label: x, on: x === when ? 'true' : 'false', bg: x === when ? '#2A2A2F' : 'transparent', fg: x === when ? '#F2F2F3' : '#8E8E96', pick: () => this.setState({ when: x, done: false }) }));
return {
rows: rows, total: total, totalCol: total === 100 ? '#3DD68C' : '#F5B14C', whens: whens,
turn: turnover.toFixed(0) + '%', cost: '$' + (turnover / 100 * 248000 * 0.0012).toFixed(2), vol: vol.toFixed(0) + '%',
summary: changed.length ? changed.join(' · ') : 'No changes yet',
whenShort: when, whenText: 'in ' + when, done: this.state.done,
disabled: ok ? 'false' : 'true',
schedule: () => { if (ok) this.setState({ done: true }); },
cta: ok ? { bg: '#F2F2F3', fg: '#0B0B0D', label: 'Schedule version 4' } : { bg: '#1F1F23', fg: '#8E8E96', label: total !== 100 ? 'Weights must total 100%' : 'Change at least one weight' }
};
}
}
return Component; })()
