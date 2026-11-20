"use client";
import { useMemo } from "react";
import { useChrome } from "../lib/chrome";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { StatesScreen, title } from "./gen/States.gen";
import { statesVM } from "./states.vm";

export default function States() {
  const { me } = useChrome();
  const v = useMemo(() => statesVM(me), [me]);
  return (
    <Shell title={title}>
      <StatesScreen v={v} nav={nav} />
    </Shell>
  );
}
