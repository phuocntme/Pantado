"use client";
import { useMemo, useState } from "react";
import { useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { MarketplaceScreen, title } from "./gen/Marketplace.gen";
import { marketplaceVM, type BoardRow, type Filter, type VolumeTotals } from "./marketplace.vm";

export default function Marketplace() {
  const [f, setF] = useState<Filter>("All");
  const board = useApi<BoardRow[]>("/board", 10_000);
  const totals = useApi<VolumeTotals>("/volume", 30_000);
  const { me } = useChrome();
  const v = useMemo(() => marketplaceVM(board.data ?? [], f, setF, me, totals.data ?? null), [board.data, f, me, totals.data]);
  return (
    <Shell title={title}>
      <MarketplaceScreen v={v} nav={nav} />
    </Shell>
  );
}
