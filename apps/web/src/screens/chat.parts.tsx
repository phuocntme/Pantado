"use client";
/**
 * Ask conversation (scripts/bindings/chat.ts): the conversation column with each answer's cards drawn inside it —
 * the asset / draft / index panels the reference shows as side columns sit under their answer.
 */
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { logoFill } from "../lib/logos";
import { DOWN, UP, pct } from "../lib/fmt";
import { css, type Scope } from "../lib/tpl";
import { candleRects, linePaths, type Candle } from "./chat.charts";
import type { AgentCard } from "./chat.sse";
import { draftHref, usd, type AssetCardData, type Block, type CardView, type CompareRow, type DraftCardData, type IndexCardData } from "./chat.vm";

const P = "margin: 0; font-size: 16px; line-height: 1.65; color: #E4E4E7";
/** The conversation column: centred, one width for questions, answers, cards and the ask box. */
const COLUMN = "width: 100%; max-width: 860px; margin: 0 auto; box-sizing: border-box; display: flex; flex-direction: column";
const BTN1 = "display: inline-flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 20px; background: #F2F2F3; color: #0B0B0D; border-radius: 12px; font-size: 15px; font-weight: 700";
const BTN2 = "display: inline-flex; align-items: center; min-height: 48px; padding: 0 18px; background: #1A1A1D; color: #F2F2F3; border-radius: 12px; font-size: 15px; font-weight: 600";
const col = (s: string): string => (s === "—" ? "#8E8E96" : s.charAt(0) === "-" ? DOWN : UP);

const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Logo = ({ w = 19, h = 14 }: { w?: number; h?: number }) => (
  <svg width={w} height={h} viewBox="10 14 324 241" aria-hidden="true">
    <path d="M94 16H238C291 16 331 60 331 113C331 166 291 206 240 206H213L219 200C247 195 267 176 267 153C267 126 247 104 221 104H94Z" fill="#F4F2FA" />
    <path d="M137 146V252H12V214C12 176 42 146 80 146Z" fill="#9052F9" />
  </svg>
);

/** Level / price line chart in the reference style (dashed start line, area at 10% opacity). */
export function LineChart({ values, label, height = 150 }: { values: number[]; label: string; height?: number }): ReactNode {
  const p = linePaths(values);
  if (!p) return null;
  return (
    <svg viewBox="0 0 400 150" preserveAspectRatio="none" role="img" aria-label={label} style={css(`display: block; width: 100%; height: ${height}px`)}>
      <line x1="0" y1={p.baseY} x2="400" y2={p.baseY} stroke="#2A2A2F" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <polygon points={p.area} fill={p.color} opacity="0.10" />
      <polyline points={p.line} fill="none" stroke={p.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function CandleChart({ candles, label }: { candles: Candle[]; label: string }): ReactNode {
  const rs = candleRects(candles);
  if (!rs.length) return null;
  return (
    <svg viewBox="0 0 400 170" preserveAspectRatio="none" role="img" aria-label={label} shapeRendering="crispEdges" style={css("display: block; width: 100%; height: 120px")}>
      {rs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={r.fill} />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------ inline card actions (conversation column)

function CardInline({ card, assetSym }: { card: AgentCard; assetSym: (id: string) => string }): ReactNode {
  if (card.kind === "asset") {
    const a = card.data as AssetCardData;
    return (
      <div style={css("display: flex; flex-wrap: wrap; gap: 8px")}>
        <a style={css(BTN1)} href={`/asset/${a.id}`}>
          {`Trade ${a.displaySymbol ?? a.symbol}`}
          <Arrow />
        </a>
        <a style={css(BTN2)} href="/create">
          {"Add to an index"}
        </a>
      </div>
    );
  }
  if (card.kind === "index") {
    const d = (card.data as IndexCardData).detail;
    return (
      <div style={css("display: flex; flex-wrap: wrap; gap: 8px")}>
        <a style={css(BTN1)} href={`/index/${d.id}`}>
          {"Open index"}
          <Arrow />
        </a>
        <a style={css(BTN2)} href={`/index/${d.id}`}>
          {"Buy $50"}
        </a>
      </div>
    );
  }
  if (card.kind === "draft") {
    const d = card.data as DraftCardData;
    return (
      <>
        <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px")}>
          <a href={draftHref(d)} style={css("text-align: left; display: flex; flex-direction: column; gap: 12px; padding: 16px; background: #1A1A1D; border: 1px solid #F2F2F3; border-radius: 14px; color: #F2F2F3")}>
            <span style={css("display: flex; justify-content: space-between; gap: 8px; width: 100%; font-size: 15px; font-weight: 600")}>
              <span>{d.name}</span>
              <span style={css("color: #8E8E96; font-weight: 500")}>{d.ticker}</span>
            </span>
            <span style={css("font-size: 13px; color: #8E8E96")}>{d.components.map((c, i) => `${assetSym(c)} ${Math.round(d.weights[i] ?? 0)}%`).join(" · ")}</span>
          </a>
        </div>
        <div style={css("display: flex; flex-wrap: wrap; gap: 8px")}>
          <a style={css(BTN1)} href={draftHref(d)}>
            {"View"}
            <Arrow />
          </a>
        </div>
      </>
    );
  }
  const rows = (card.data as CompareRow[]).filter((r) => !r.missing);
  if (rows.length < 2) return null;
  const line = (k: string, f: (r: CompareRow) => string, colored = false) => (
    <tr style={css("border-top: 1px solid #1C1C20")}>
      <th scope="row" style={css("padding: 12px 16px; text-align: left; font-weight: 400; color: #8E8E96")}>
        {k}
      </th>
      {rows.map((r, i) => (
        <td key={i} style={css(`padding: 12px 16px; color: ${colored ? col(f(r)) : "#F2F2F3"}`)}>
          {f(r)}
        </td>
      ))}
    </tr>
  );
  return (
    <div style={css("overflow-x: auto; background: #0B0B0D; border: 1px solid #1C1C20; border-radius: 14px")}>
      <table style={css("width: 100%; min-width: 440px; border-collapse: collapse; font-size: 14px")}>
        <thead>
          <tr>
            <td style={css("padding: 14px 16px")}></td>
            {rows.map((r, i) => (
              <th key={i} scope="col" style={css("padding: 14px 16px; text-align: left")}>
                <span style={css("display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600")}>
                  <span
                    style={css(`width: 20px; height: 20px; border-radius: 50%; background: ${logoFill(r.id) ?? r.color ?? "#8E8E96"}; display: inline-flex; align-items: center; justify-content: center; flex: none; color: #FFFFFF; letter-spacing: -0.02em; font-size: 10px; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.45)`)}
                    aria-hidden="true"
                  >
                    {logoFill(r.id) ? "" : (r.symbol ?? r.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
                  </span>
                  {r.symbol ?? r.id}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {line("Price", (r) => usd(r.price?.usd ?? null))}
          {line("24h", (r) => pct(r.change24h ?? null), true)}
          {line("30d", (r) => pct(r.change30d ?? null), true)}
          <tr style={css("border-top: 1px solid #1C1C20")}>
            <td></td>
            {rows.map((r, i) => (
              <td key={i} style={css("padding: 12px 16px 16px")}>
                <a style={css("display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; background: #F2F2F3; color: #0B0B0D; border-radius: 10px; font-size: 14px; font-weight: 700")} href={`/asset/${r.id}`}>
                  {`Trade ${r.symbol ?? r.id}`}
                  <Arrow />
                </a>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ conversation column

interface TurnVM {
  q: string;
  mode: "auto" | "deep";
  meta: string;
  blocks: Block[];
  cards: AgentCard[];
  views: CardView[];
  status: "streaming" | "done" | "error";
  error: string | null;
}

export function Conversation({
  v,
  onAsk,
  assetSym,
}: {
  v: Scope;
  onAsk: (text: string, mode: "auto" | "deep") => void;
  assetSym: (id: string) => string;
}): ReactNode {
  const [text, setText] = useState("");
  // Auto / Deep for the next question; follows the latest answer's mode until the user picks one
  const [picked, setPicked] = useState<"auto" | "deep" | null>(null);
  const turns = (v.turns as TurnVM[] | undefined) ?? [];
  const related = (v.related as { text: string; pick: () => void }[] | undefined) ?? [];
  const busy = v.streaming === true;
  const mode = picked ?? (turns[turns.length - 1]?.mode ?? "auto");
  // the conversation scrolls on its own: follow new text while the reader is at the bottom
  const scroller = useRef<HTMLElement | null>(null);
  const atBottom = useRef(true);
  const lastText = turns.length ? turns[turns.length - 1]?.blocks.length ?? 0 : 0;
  const tail = `${turns.length}:${lastText}:${JSON.stringify(turns[turns.length - 1]?.blocks ?? []).length}:${turns[turns.length - 1]?.cards.length ?? 0}`;
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [tail]);
  // every card is drawn the same way; the newest of each kind also has its live chart / history
  const cardOf = (view: CardView | undefined, raw: AgentCard): ReactNode => {
    const sc = view?.scope;
    if (view?.kind === "asset" && sc) return <AssetCard a={sc} />;
    if (view?.kind === "index" && sc) return <IndexCard ix={sc} />;
    if (view?.kind === "draft" && sc) return <DraftCard d={sc} />;
    return <CardInline card={raw} assetSym={assetSym} />;
  };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    onAsk(text.trim(), mode);
    setText("");
  };
  return (
    <section
      ref={scroller}
      aria-label="Conversation"
      className="convscroll"
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      style={css("flex: 999 1 440px; min-width: 0; display: flex; flex-direction: column; padding: 16px 8px 0")}
    >
      {/* one centred column: questions, answers, cards, related and the ask box share its width */}
      <div style={css(`${COLUMN}; flex: 1 1 auto; gap: 28px`)}>
      {turns.map((t, i) => (
        <Fragment key={i}>
          <div style={css("align-self: flex-end; max-width: 78%; padding: 14px 20px; background: #1A1A1D; border-radius: 20px; font-size: 16px; line-height: 1.5")}>{t.q}</div>
          <div style={css("display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 14px; align-items: start")}>
            <span style={css("display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: #1A1A1D")} aria-hidden="true">
              <Logo w={16} h={12} />
            </span>
            <div style={css("display: flex; flex-direction: column; gap: 16px; min-width: 0")}>
              {t.meta && (
                <span style={css("align-self: flex-start; display: inline-flex; align-items: center; min-height: 32px; padding: 0 14px; background: #1A1A1D; border-radius: 999px; font-size: 13px; color: #B4B4BB")}>
                  {t.meta}
                </span>
              )}
              {t.blocks.map((b, j) =>
                b.kind === "p" ? (
                  <p key={j} style={css(P)}>
                    {b.text}
                  </p>
                ) : (
                  <ul key={j} style={css("margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 16px; line-height: 1.65; color: #E4E4E7")}>
                    {b.items.map((li, k) => (
                      <li key={k} style={css("display: flex; gap: 12px")}>
                        <span style={css("flex: none; width: 5px; height: 5px; margin-top: 11px; border-radius: 50%; background: #9052F9")} aria-hidden="true"></span>
                        <span>{li}</span>
                      </li>
                    ))}
                  </ul>
                ),
              )}
              {t.status !== "streaming" &&
                t.cards.map((c, j) => <Fragment key={j}>{cardOf(t.views[j], c)}</Fragment>)}
              {t.status === "error" && (
                <div role="alert" style={css("display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; background: #2A1212; border: 1px solid #4A1F1F; border-radius: 12px; font-size: 13px; line-height: 1.5")}>
                  <strong style={css("color: #FF6B6B")}>{"The agent could not answer."}</strong>
                  <span style={css("color: #B4B4BB")}>{t.error ?? ""}</span>
                </div>
              )}
            </div>
          </div>
        </Fragment>
      ))}
      {related.length > 0 && (
        <div style={css("display: flex; flex-direction: column; padding-left: 46px")}>
          <span style={css("padding: 0 10px 8px; font-size: 13px; color: #8E8E96")}>{"Related"}</span>
          {related.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={r.pick}
              disabled={busy}
              style={css("display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 0 10px; background: transparent; border: 0; border-top: 1px solid #1C1C20; color: #F2F2F3; font-size: 15px; text-align: left")}
            >
              {r.text}
              <span style={css("color: #8E8E96")}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M4 10l6-6M5 4h5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      )}
      <form className="askbox convbox" onSubmit={submit} style={css("margin-top: auto; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 18px; background: #0B0B0D; border: 1px solid #26262B; border-radius: 18px")}>
        <label htmlFor="follow" style={css("position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)")}>
          {"Ask a follow-up"}
        </label>
        <input
          id="follow"
          type="text"
          placeholder="Ask anything"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={css("flex: 1 1 auto; min-width: 0; min-height: 48px; background: transparent; border: 0; color: #F2F2F3; font-family: inherit; font-size: 16px")}
        />
        <div role="group" aria-label="Depth" style={css("display: flex; flex: none; padding: 3px; background: #1A1A1D; border-radius: 10px")}>
          {(["auto", "deep"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setPicked(m)}
              title={m === "auto" ? "Fast answers" : "Longer analysis with more lookups"}
              style={css(`min-height: 36px; padding: 0 12px; background: ${mode === m ? "#F2F2F3" : "transparent"}; color: ${mode === m ? "#0B0B0D" : "#B4B4BB"}; border: 0; border-radius: 8px; font-size: 13px; font-weight: 500`)}
            >
              {m === "auto" ? "Auto" : "Deep"}
            </button>
          ))}
        </div>
        <button type="submit" aria-label="Send" disabled={busy} style={css("width: 48px; height: 48px; background: #9052F9; color: #FFFFFF; border: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center")}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M9 14V4M4.5 8.5L9 4l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ rich cards (inside the answer)

/** One answer card in the conversation column: a compact panel under the text, not a side column. */
const CARD = "box-sizing: border-box; padding: 16px; background: #0B0B0D; border: 1px solid #1C1C20; border-radius: 16px; display: flex; flex-direction: column; gap: 12px";
const PRICE = "font-family: 'Inter Tight', sans-serif; font-size: 22px; font-weight: 600; letter-spacing: -0.02em";
const BTN_S1 = "display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 16px; background: #F2F2F3; color: #0B0B0D; border-radius: 10px; font-size: 14px; font-weight: 700";
const BTN_S2 = "display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; background: #1A1A1D; color: #F2F2F3; border-radius: 10px; font-size: 14px; font-weight: 600";
const PILL = "padding: 3px 9px; border-radius: 999px; background: #1F1F23; color: #B4B4BB; font-size: 11px; font-weight: 600";

/** Small "label value" stats in one line ("Vol 24h $12.9M · 30d -11.1%"). */
function Stats({ items }: { items: { k: string; v: string; c?: string }[] }): ReactNode {
  const shown = items.filter((x) => x.v && x.v !== "—");
  if (!shown.length) return null;
  return (
    <div style={css("display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px")}>
      {shown.map((x, i) => (
        <span key={i} style={css("display: inline-flex; gap: 6px")}>
          <span style={css("color: #8E8E96")}>{x.k}</span>
          <span style={css(`font-weight: 600; color: ${x.c ?? "#F2F2F3"}`)}>{x.v}</span>
        </span>
      ))}
    </div>
  );
}

/** Weights as chips ("NVDA 25%"), the largest first. */
function WeightChips({ rows }: { rows: { t: string; w: number; c: string }[] }): ReactNode {
  if (!rows.length) return null;
  return (
    <div style={css("display: flex; flex-wrap: wrap; gap: 6px")}>
      {rows.map((r, i) => (
          <span key={i} style={css("display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #131316; border-radius: 999px; font-size: 12px")}>
            <span style={css(`width: 7px; height: 7px; border-radius: 50%; background: ${r.c}`)} aria-hidden="true"></span>
            <span style={css("font-weight: 600")}>{r.t}</span>
            <span style={css("color: #8E8E96")}>{`${Math.round(r.w)}%`}</span>
          </span>
      ))}
    </div>
  );
}

/** One bar split by weight, in the chips' colors: the basket at a glance. */
function WeightBar({ rows }: { rows: { t: string; w: number; c: string }[] }): ReactNode {
  const total = rows.reduce((t, r) => t + r.w, 0);
  if (!rows.length || total <= 0) return null;
  return (
    <div role="img" aria-label={rows.map((r) => `${r.t} ${Math.round(r.w)}%`).join(", ")} style={css("display: flex; gap: 2px; height: 8px; border-radius: 999px; overflow: hidden; background: #131316")}>
      {rows.map((r, i) => (
        <span key={i} title={`${r.t} ${Math.round(r.w)}%`} style={css(`flex: ${r.w} 1 0; min-width: 3px; background: ${r.c}`)}></span>
      ))}
    </div>
  );
}

function Head({ avatar, title, sub, pill, pillStyle, right }: { avatar?: ReactNode; title: string; sub: string; pill: string; pillStyle?: string; right: ReactNode }): ReactNode {
  return (
    <div style={css("display: flex; align-items: center; justify-content: space-between; gap: 12px")}>
      <span style={css("display: inline-flex; align-items: center; gap: 10px; min-width: 0")}>
        {avatar}
        <span style={css("display: flex; flex-direction: column; min-width: 0")}>
          <span style={css("display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600")}>
            {title}
            <span style={css(pillStyle ?? PILL)}>{pill}</span>
          </span>
          <span style={css("font-size: 12px; color: #8E8E96; white-space: nowrap; overflow: hidden; text-overflow: ellipsis")}>{sub}</span>
        </span>
      </span>
      {right}
    </div>
  );
}

const PriceRight = ({ value, chg, chgCol }: { value: string; chg: string; chgCol: string }) => (
  <span style={css("display: flex; flex-direction: column; align-items: flex-end; flex: none")}>
    <span style={css(PRICE)}>{value}</span>
    {chg && chg !== "—" ? <span style={css(`font-size: 13px; font-weight: 600; color: ${chgCol}`)}>{chg}</span> : null}
  </span>
);

export function AssetCard({ a }: { a: Scope }): ReactNode {
  const s = (k: string): string => String(a[k] ?? "");
  const candles = (a.candles as Candle[] | undefined) ?? [];
  return (
    <div aria-label={s("sym")} style={css(CARD)}>
      <Head
        avatar={
          <span
            style={css(`width: 30px; height: 30px; border-radius: 50%; background: ${s("dot")}; display: inline-flex; align-items: center; justify-content: center; flex: none; color: #FFFFFF; font-size: 12px; font-weight: 700`)}
            aria-hidden="true"
          >
            {s("ini2")}
          </span>
        }
        title={s("sym")}
        sub={s("name")}
        pill={s("kind")}
        right={<PriceRight value={s("price")} chg={s("chg")} chgCol={s("chgCol")} />}
      />
      {candles.length ? <CandleChart candles={candles} label={`${s("sym")} price, last 60 days`} /> : null}
      <Stats items={[{ k: "Vol 24h", v: s("vol24") }, { k: "30d", v: s("m30"), c: s("m30Col") }, { k: "Liquidity", v: s("liq") }]} />
      <div style={css("display: flex; flex-wrap: wrap; align-items: center; gap: 8px")}>
        <a style={css(BTN_S1)} href={s("href")}>
          {`Trade ${s("sym")}`}
          <Arrow />
        </a>
        <a style={css(BTN_S2)} href="/create">
          {"Add to an index"}
        </a>
        {a.badge ? <span style={css("margin-left: auto; font-size: 11px; color: #8E8E96")}>{s("badge")}</span> : null}
      </div>
    </div>
  );
}

export function DraftCard({ d }: { d: Scope }): ReactNode {
  const s = (k: string): string => String(d[k] ?? "");
  return (
    <div aria-label="Selected basket" style={css(CARD)}>
      <Head
        title={s("name")}
        sub={s("ret") && s("ret") !== "—" ? "90-day backtest" : `${((d.assets as unknown[] | undefined) ?? []).length} assets · review and sign in Create`}
        pill="Draft"
        pillStyle="padding: 3px 9px; border-radius: 999px; background: #221637; color: #C9B3FD; font-size: 11px; font-weight: 600"
        right={s("ret") && s("ret") !== "—" ? <span style={css(`${PRICE}; color: ${col(s("ret"))}`)}>{s("ret")}</span> : null}
      />
      <WeightBar rows={(d.assets as { t: string; w: number; c: string }[] | undefined) ?? []} />
      <WeightChips rows={(d.assets as { t: string; w: number; c: string }[] | undefined) ?? []} />
      <Stats
        items={[
          { k: "Volatility", v: s("vol") },
          { k: "Drawdown", v: s("dd"), c: DOWN },
          { k: "Slippage", v: s("slip") },
        ]}
      />
      <div style={css("display: flex; flex-wrap: wrap; gap: 8px")}>
        {/* one action: both used to open Create with this draft */}
        <a style={css(BTN_S1)} href={s("href")}>
          {"View"}
          <Arrow />
        </a>
      </div>
    </div>
  );
}

export function IndexCard({ ix }: { ix: Scope }): ReactNode {
  const s = (k: string): string => String(ix[k] ?? "");
  const levels = (ix.levels as number[] | undefined) ?? [];
  return (
    <div aria-label={s("name")} style={css(CARD)}>
      <Head
        title={s("name")}
        sub={s("by")}
        pill="Index"
        pillStyle="padding: 3px 9px; border-radius: 999px; background: #221637; color: #C9B3FD; font-size: 11px; font-weight: 600"
        right={<PriceRight value={s("level")} chg={s("m30")} chgCol={s("m30Col")} />}
      />
      {levels.length ? <LineChart values={levels} label={`${s("name")} level, 90 days`} height={110} /> : null}
      <WeightBar rows={(ix.comp as { t: string; w: number; c: string }[] | undefined) ?? []} />
      <WeightChips rows={(ix.comp as { t: string; w: number; c: string }[] | undefined) ?? []} />
      <Stats
        items={[
          { k: "Holders", v: s("holders") },
          { k: "Volatility", v: s("vol") },
          { k: "Drawdown", v: s("dd"), c: DOWN },
        ]}
      />
      <div style={css("display: flex; flex-wrap: wrap; align-items: center; gap: 8px")}>
        <a style={css(BTN_S1)} href={s("href")}>
          {"Open index"}
          <Arrow />
        </a>
        <a style={css(BTN_S2)} href={s("href")}>
          {"Buy $50"}
        </a>
        {ix.badge ? <span style={css("margin-left: auto; font-size: 11px; color: #8E8E96")}>{s("badge")}</span> : null}
      </div>
    </div>
  );
}

export interface ConvRowData {
  id: string;
  title: string;
  on: string;
  bg: string;
  fg: string;
  pick: () => void;
  del: () => void;
}

const ROW = "display: flex; align-items: center; min-height: 44px; padding: 0 12px; border: 0; border-radius: 10px; font-size: 14px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis";
const TRASH = "position: absolute; top: 50%; right: 6px; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; min-width: 32px; padding: 0 8px; border: 0; border-radius: 8px; font-size: 13px; font-weight: 600";

/**
 * One history row: the reference button, plus a delete control shown on hover, on focus and on the open
 * conversation. The first press arms it ("Delete"), the second removes the conversation; leaving the row disarms it.
 */
export function ConvRow({ cv }: { cv: ConvRowData }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [armed, setArmed] = useState(false);
  const show = hover || focus || armed || cv.on === "true";
  return (
    <div
      style={css("position: relative; display: flex; flex-direction: column")}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setArmed(false);
      }}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setFocus(false);
        setArmed(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setArmed(false);
      }}
    >
      <button
        type="button"
        onClick={cv.pick}
        aria-pressed={cv.on === "true"}
        style={{ ...css(ROW), width: "100%", background: cv.bg, color: cv.fg, paddingRight: show ? (armed ? 92 : 44) : 12 }}
      >
        {/* the title truncates itself: a flex button cannot ellipsize its bare text, which then ran under the delete control */}
        <span style={css("display: block; min-width: 0; flex: 1 1 auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis")}>{cv.title}</span>
      </button>
      {show ? (
        <button
          type="button"
          aria-label={armed ? `Confirm delete “${cv.title}”` : `Delete “${cv.title}”`}
          title={armed ? "Click again to delete" : "Delete chat"}
          onClick={(e) => {
            e.stopPropagation();
            if (armed) cv.del();
            else setArmed(true);
          }}
          style={{ ...css(TRASH), background: armed ? "rgba(255,90,90,0.14)" : "transparent", color: armed ? DOWN : "#8E8E96" }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2.5 3.5h9M5.5 3.5V2.25h3V3.5M3.75 3.5l.6 8.25h5.3l.6-8.25M5.9 5.75v4M8.1 5.75v4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {armed ? "Delete" : null}
        </button>
      ) : null}
    </div>
  );
}
