"use client";
/**
 * Redeem container (app/redeem/[id]): the Redeem modal over Portfolio. Sends IndexVault.redeem(units, me, forfeit)
 * — in-kind, no fee, no price, never paused — so it is offered even when buy/sell are stopped by a stale price.
 */
import { useCallback, useState } from "react";
import { isAddress, type Address } from "viem";
import { tx } from "@pantado/sdk";
import { useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { css } from "../lib/tpl";
import { useTx, useWallet } from "../lib/wallet";
import { RedeemScreen, title } from "./gen/Redeem.gen";
import { toBase, UNIT_DECIMALS, type AssetInfo, type BoardAsset, type Composition, type IndexDetail, type Portfolio } from "./index.data";
import { Alert, TxStatus, WrongNetwork } from "./index.parts";
import { redeemVM } from "./redeem.vm";

const ini = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

export default function RedeemPage({ id, units }: { id: string; units: string | null }) {
  const valid = isAddress(id);
  const base = valid ? `/indexes/${id}` : null;
  const { me } = useChrome();
  const w = useWallet();
  const detail = useApi<IndexDetail>(base, 30_000);
  const comp = useApi<Composition>(base && `${base}/composition`, 15_000);
  const portfolio = useApi<Portfolio>(w.address ? `/portfolio/${w.address}` : null, 15_000);
  const assets = useApi<AssetInfo[]>("/assets");
  const board = useApi<BoardAsset[]>("/board", 60_000);
  const run = useTx();

  const [forfeit, setForfeit] = useState<string[]>([]);
  const [step, setStep] = useState<"review" | "done">("review");
  const [txHash, setTxHash] = useState<string | null>(null);

  const redeem = useCallback(
    (u: bigint, skip: string[]) => {
      if (!w.address || !valid || run.state.status === "pending") return;
      void run.run([tx.redeem(id as Address, u, w.address, skip as Address[])]).then((h) => {
        if (h) {
          setTxHash(h);
          setStep("done");
          portfolio.reload();
          comp.reload();
        }
      });
    },
    [w.address, valid, run, id, portfolio, comp],
  );

  const v = redeemVM(
    {
      id,
      detail: detail.data,
      comp: comp.data,
      portfolio: portfolio.data,
      assets: assets.data,
      board: board.data,
      unitsParam: units ? toBase(units, UNIT_DECIMALS) : null,
      me,
    },
    { forfeit, step, txHash, pending: run.state.status === "pending" },
    { toggle: (a) => setForfeit((f) => (f.includes(a) ? f.filter((x) => x !== a) : [...f, a])), redeem },
  );

  const error = !valid ? "This is not an index address." : detail.error?.message ?? comp.error?.message ?? null;
  const slots = {
    allocBar: () => (
      <div style={css("display: flex; height: 8px; gap: 2px; border-radius: 4px; overflow: hidden")} aria-hidden="true">
        <span style={css(`display: block; width: ${v.bg.alloc.stocks}%; background: #F2F2F3`)}></span>
        <span style={css(`display: block; width: ${v.bg.alloc.tokens}%; background: #E84142`)}></span>
        <span style={css(`display: block; width: ${v.bg.alloc.cash}%; background: #2775CA`)}></span>
      </div>
    ),
    legs: () => (
      <div style={css("display: flex; flex-direction: column")}>
        {v.legs.map((l) => (
          <label
            key={l.asset}
            style={css("display: grid; grid-template-columns: 24px 1fr auto auto; align-items: center; gap: 10px; min-height: 44px; padding: 4px 2px; border-top: 1px solid #17171A; font-size: 14px")}
          >
            <input type="checkbox" checked={l.checked} onChange={l.toggle} style={css("width: 18px; height: 18px; accent-color: #9052F9")} />
            <span style={css("display: inline-flex; align-items: center; gap: 8px; font-weight: 600")}>
              <span
                style={css(
                  `width: 20px; height: 20px; border-radius: 50%; background: ${l.logo ?? l.color}; display: inline-flex; align-items: center; justify-content: center; flex: none; color: #FFFFFF; letter-spacing: -0.02em; font-size: 10px; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.45)`,
                )}
                aria-hidden="true"
              >
                {l.logo ? "" : ini(l.sym)}
              </span>
              {l.sym}
            </span>
            <span>{l.amt}</span>
            <span style={css("width: 76px; text-align: right; color: #8E8E96")}>{l.usd}</span>
          </label>
        ))}
        {error ? <Alert tone="error" title={error} /> : null}
        {v.empty ? <Alert tone="info" title={`You hold no ${v.ticker} to redeem.`} /> : null}
        {w.address && !w.chainOk ? <WrongNetwork onSwitch={() => void w.switchChain()} /> : null}
        {run.state.status !== "confirmed" ? (
          <TxStatus state={run.state} pending={`One signature redeems ${v.amountS}`} confirmed="" failed="Redeem failed" />
        ) : null}
      </div>
    ),
    confirm: () =>
      w.address ? (
        <button
          type="button"
          onClick={v.toDone}
          aria-disabled={v.canRedeem ? "false" : "true"}
          style={css(`min-height: 52px; background: #F2F2F3; color: #0B0B0D; border: 0; border-radius: 12px; font-size: 15px; font-weight: 700${v.canRedeem ? "" : "; opacity: 0.5"}`)}
        >
          {run.state.status === "pending" ? "Confirm in your wallet" : `Redeem ${v.unitsL}`}
        </button>
      ) : (
        <a href="/connect" style={css("display: flex; align-items: center; justify-content: center; min-height: 52px; background: #F2F2F3; color: #0B0B0D; border-radius: 12px; font-size: 15px; font-weight: 700")}>
          {`Redeem ${v.unitsL}`}
        </a>
      ),
  };

  return (
    <Shell title={title}>
      <RedeemScreen v={v} nav={nav} slots={slots} />
    </Shell>
  );
}
