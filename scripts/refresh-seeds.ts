/**
 * Refresh `price.seedUsd` and the oracle band (`bandMinUsd` = seed × BAND_LOW, `bandMaxUsd` = seed × BAND_HIGH)
 * in config/assets.json from a running market-data service in live mode, then run `pnpm gen:config`.
 *
 *   MARKET_DATA_URL=http://127.0.0.1:8080 pnpm --filter @pantado/scripts refresh:seeds          # write
 *   MARKET_DATA_URL=http://127.0.0.1:8080 pnpm --filter @pantado/scripts refresh:seeds --check  # report only
 *
 * Seeds are the first price of the Fuji test tokens and the centre of the oracle band, so a seed far from the
 * market makes the first push jump and can leave the live price near a band edge (the pusher then skips it).
 * Assets without a live price keep their current values. Edits are in place so the file keeps its layout.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot, loadAssets } from "@pantado/shared";

const BAND_LOW = 0.2;
const BAND_HIGH = 5;
/** Drift (vs. the seed) above which `--check` fails. */
const MAX_DRIFT = 0.25;

interface Snapshot {
  prices: { id: string; canonical: { usd: string } | null }[];
}

/** At least 4 significant digits (whole dollars above 1000), plain decimal (no exponent). */
export function sig4(x: number): string {
  if (!(x > 0)) throw new Error(`bad price ${x}`);
  const digits = Math.max(0, 3 - Math.floor(Math.log10(x)));
  const s = x.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Replace `"key": "<value>"` inside the object that starts at `"id": "<id>"` (up to the next `"id":`). */
export function setField(text: string, id: string, key: string, value: string): string {
  const start = text.indexOf(`"id": "${id}"`);
  if (start < 0) throw new Error(`asset ${id} not found`);
  const next = text.indexOf(`"id": "`, start + 1);
  const end = next < 0 ? text.length : next;
  const block = text.slice(start, end);
  const re = new RegExp(`("${key}": )"[^"]*"`);
  if (!re.test(block)) throw new Error(`${id}: ${key} not found`);
  return text.slice(0, start) + block.replace(re, `$1"${value}"`) + text.slice(end);
}

async function main(): Promise<number> {
  const check = process.argv.includes("--check");
  const base = process.env.MARKET_DATA_URL ?? "http://127.0.0.1:8080";
  const res = await fetch(`${base}/internal/prices`);
  if (!res.ok) throw new Error(`${base}/internal/prices → ${res.status}`);
  const snap = (await res.json()) as Snapshot;
  const live = new Map(snap.prices.filter((p) => p.canonical).map((p) => [p.id, Number(p.canonical?.usd)]));

  const root = findRepoRoot();
  const path = join(root, "config/assets.json");
  let text = readFileSync(path, "utf8");
  let drifted = 0;
  for (const a of loadAssets()) {
    if (a.price.canonical === "fixed" || a.price.seedUsd === undefined) continue;
    const usd = live.get(a.id);
    const seed = Number(a.price.seedUsd);
    if (usd === undefined) {
      console.log(`keep     ${a.id.padEnd(6)} seed ${a.price.seedUsd} (no live price)`);
      continue;
    }
    const drift = usd / seed - 1;
    const inBand = usd >= Number(a.price.bandMinUsd) && usd <= Number(a.price.bandMaxUsd);
    if (Math.abs(drift) > MAX_DRIFT || !inBand) drifted += 1;
    const next = sig4(usd);
    console.log(
      `${check ? (Math.abs(drift) > MAX_DRIFT || !inBand ? "DRIFT " : "ok    ") : "update"}   ${a.id.padEnd(6)} seed ${a.price.seedUsd} → ${next} (${(drift * 100).toFixed(1)}%${inBand ? "" : ", OUTSIDE BAND"})`,
    );
    if (check) continue;
    text = setField(text, a.id, "seedUsd", next);
    text = setField(text, a.id, "bandMinUsd", sig4(Number(next) * BAND_LOW));
    text = setField(text, a.id, "bandMaxUsd", sig4(Number(next) * BAND_HIGH));
  }
  if (check) {
    if (drifted) console.error(`${drifted} asset(s) drift > ${MAX_DRIFT * 100}% or sit outside their band — run refresh:seeds`);
    return drifted ? 1 : 0;
  }
  writeFileSync(path, text);
  console.log("written  config/assets.json — now run `pnpm gen:config`");
  return 0;
}

if (process.argv[1]?.endsWith("refresh-seeds.ts")) {
  main().then(
    (c) => (process.exitCode = c),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    },
  );
}
