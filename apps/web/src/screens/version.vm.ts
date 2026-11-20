/**
 * New version view model — same shape as reference/logic/version.js (rows, total, totalCol, whens, turn, cost,
 * vol, summary, whenShort, whenText, done, disabled, schedule, cta). Weights are whole percents; the
 * transaction sends bps (each ≥ 100, sum 10 000). Only the creator of a Manual index with no plan in progress
 * may publish (Rebalancer.publishVersion).
 */
import { withInitials } from "../lib/fmt";
import { logoAvatar, logoFill } from "../lib/logos";
import type { Me } from "../lib/chrome";
import { MODE, PLAN, until, wad, type AssetInfo, type Composition, type Holder, type IndexDetail, type Levels } from "./index.data";
import { dailyCandles } from "./index.chart";
import { volatility } from "./index.vm";

export type When = "48h" | "72h" | "7 days";
export const WHENS: When[] = ["48h", "72h", "7 days"];

export interface VersionInput {
  detail: IndexDetail | null;
  comp: Composition | null;
  holders: Holder[] | null;
  levels: Levels | null;
  assets: AssetInfo[] | null;
  me: Me;
  now: number;
}
export interface VersionState {
  /** New weight in whole percent per asset address (lower-case); missing = unchanged. */
  w: Record<string, number>;
  when: When;
  reason: string;
  done: boolean;
  pending: boolean;
}
export interface VersionHandlers {
  setWeight: (asset: string, pct: number) => void;
  setWhen: (w: When) => void;
  schedule: (weightsBps: number[]) => void;
}

export type Blocker = null | "loading" | "notCreator" | "notManual" | "planInProgress";

export function blocker(detail: IndexDetail | null, me: string | null): Blocker {
  if (!detail) return "loading";
  if (!me || detail.creator.toLowerCase() !== me.toLowerCase()) return "notCreator";
  if (detail.mode !== MODE.Manual) return "notManual";
  const s = detail.plan?.status;
  if (s === PLAN.Scheduled || s === PLAN.Active) return "planInProgress";
  return null;
}

const BLOCK_LABEL: Record<Exclude<Blocker, null>, string> = {
  loading: "Loading…",
  notCreator: "Only the creator can publish a version",
  notManual: "New versions are for Manual indexes",
  planInProgress: "A rebalance is already scheduled",
};

/** Current targets in percent, from the lens (composition) or the indexed row. */
function currentTargets(detail: IndexDetail | null, comp: Composition | null): { asset: string; sym: string; id: string | null; old: number }[] {
  if (comp && comp.legs.length) return comp.legs.map((l) => ({ asset: l.asset.toLowerCase(), sym: l.symbol ?? `${l.asset.slice(0, 6)}…`, id: l.id, old: Math.round(l.targetBps / 100) }));
  if (!detail) return [];
  return detail.assets.map((a, i) => ({ asset: a.toLowerCase(), sym: `${a.slice(0, 6)}…`, id: null, old: Math.round((detail.targetBps[i] ?? 0) / 100) }));
}

export function versionVM(input: VersionInput, st: VersionState, h: VersionHandlers) {
  const { detail, comp, assets, me, now } = input;
  const next = (detail?.version ?? 0) + 1;
  const nextName = detail ? `Version ${next}` : "New version";
  const base = currentTargets(detail, comp);
  const colorOf = (id: string | null): string => (id ? (assets ?? []).find((a) => a.id === id)?.color : undefined) ?? "#8E8E96";

  const rows = base.map((b) => {
    const w = st.w[b.asset] ?? b.old;
    const d = w - b.old;
    return {
      t: b.sym,
      old: b.old,
      w,
      c: colorOf(b.id),
      ...logoAvatar(b.id),
      label: `${nextName} weight of ${b.sym}`,
      delta: d === 0 ? "—" : `${d > 0 ? "+" : ""}${d}`,
      dCol: d > 0 ? "#3DD68C" : d < 0 ? "#FF6B6B" : "#8E8E96",
      set: (e: { target: { value: string } }) => h.setWeight(b.asset, Number(e.target.value)),
    };
  });
  const total = rows.reduce((s, r) => s + r.w, 0);
  const turnover = rows.reduce((s, r) => s + Math.abs(r.w - r.old), 0) / 2;
  const changed = rows.filter((r) => r.w !== r.old).map((r) => `${r.t} ${r.old} → ${r.w}%`);
  const allMin = rows.every((r) => r.w >= 1);
  const weightsOk = rows.length > 0 && total === 100 && changed.length > 0 && allMin;
  const block = blocker(detail, me.address);
  const ok = weightsOk && block === null && !st.pending && st.reason.trim().length > 0;

  const whens = WHENS.map((x) => ({
    label: x,
    on: x === st.when ? "true" : "false",
    bg: x === st.when ? "#2A2A2F" : "transparent",
    fg: x === st.when ? "#F2F2F3" : "#8E8E96",
    pick: () => h.setWhen(x),
  }));

  // after publishing, the notice is the contract's: show the real start time
  const startAt = detail?.plan && detail.plan.status === PLAN.Scheduled ? Number(detail.plan.startAt) : null;
  const whenText = st.done && startAt ? `in ${until(startAt, now)}` : `in ${st.when}`;
  const value = wad(comp?.value ?? detail?.value);
  const vNow = volatility(dailyCandles(input.levels?.levels ?? [], []).map((c) => c.c));
  const holdersN = input.holders?.length ?? null;

  const label = (): string => {
    if (st.pending) return "Confirm in your wallet";
    if (block !== null && block !== "notCreator") return BLOCK_LABEL[block];
    if (total !== 100) return "Weights must total 100%";
    if (!allMin) return "Each weight must be at least 1%";
    if (changed.length === 0) return "Change at least one weight";
    if (!st.reason.trim()) return "Add a reason for holders";
    if (block === "notCreator") return me.address ? BLOCK_LABEL.notCreator : "Connect to publish";
    return `Schedule ${nextName.toLowerCase()}`;
  };

  return withInitials({
    me,
    heading: detail ? `Propose version ${next}` : "Propose a new version",
    nextName,
    name: detail?.name ?? "—",
    holdersS: holdersN === null ? "—" : holdersN >= 200 ? "200+" : holdersN.toLocaleString("en-US"),
    volNow: vNow === null ? "—" : `${Math.round(vNow * 100)}%`,
    rows,
    total,
    totalCol: total === 100 ? "#3DD68C" : "#F5B14C",
    whens,
    turn: `${turnover.toFixed(0)}%`,
    turnUsd: Number.isFinite(value) ? (turnover / 100) * value : null,
    cost: "—",
    vol: "—",
    summary: changed.length ? changed.join(" · ") : "No changes yet",
    whenShort: st.when,
    whenText,
    done: st.done,
    disabled: ok ? "false" : "true",
    blocker: block,
    schedule: () => {
      if (ok) h.schedule(rows.map((r) => r.w * 100));
    },
    cta: ok ? { bg: "#F2F2F3", fg: "#0B0B0D", label: label() } : { bg: "#1F1F23", fg: "#8E8E96", label: label() },
    _href: detail ? { IndexDetail: `/index/${detail.id}` } : {},
  });
}
