/**
 * Logos served from public/logos (self-hosted; no third-party image hosts at runtime).
 * Assets by registry id (config/assets.json); an asset without an entry keeps its color + initials avatar.
 * Sources and licences: public/logos/SOURCES.txt.
 */
export const ASSET_LOGOS: Readonly<Record<string, string>> = {
  aapl: "/logos/assets/aapl.png",
  aavee: "/logos/assets/aavee.png",
  amd: "/logos/assets/amd.png",
  amzn: "/logos/assets/amzn.png",
  arena: "/logos/assets/arena.png",
  ausd: "/logos/assets/ausd.png",
  avgo: "/logos/assets/avgo.png",
  baba: "/logos/assets/baba.png",
  beam: "/logos/assets/beam.png",
  black: "/logos/assets/black.png",
  btcb: "/logos/assets/btcb.png",
  coin: "/logos/assets/coin.png",
  coq: "/logos/assets/coq.png",
  cost: "/logos/assets/cost.png",
  crcl: "/logos/assets/crcl.svg",
  daie: "/logos/assets/daie.png",
  dell: "/logos/assets/dell.png",
  eurc: "/logos/assets/eurc.png",
  folks: "/logos/assets/folks.png",
  frax: "/logos/assets/frax.png",
  gme: "/logos/assets/gme.png",
  gohm: "/logos/assets/gohm.png",
  googl: "/logos/assets/googl.png",
  hims: "/logos/assets/hims.png",
  joe: "/logos/assets/joe.png",
  kimbo: "/logos/assets/kimbo.png",
  linke: "/logos/assets/linke.png",
  lly: "/logos/assets/lly.png",
  meta: "/logos/assets/meta.png",
  mim: "/logos/assets/mim.png",
  msft: "/logos/assets/msft.png",
  mstr: "/logos/assets/mstr.png",
  mu: "/logos/assets/mu.png",
  nochill: "/logos/assets/nochill.png",
  nvda: "/logos/assets/nvda.png",
  nya: "/logos/assets/nya.png",
  p33: "/logos/assets/p33.png",
  phar: "/logos/assets/phar.png",
  pltr: "/logos/assets/pltr.png",
  png: "/logos/assets/png.png",
  qi: "/logos/assets/qi.png",
  rblx: "/logos/assets/rblx.png",
  rddt: "/logos/assets/rddt.png",
  savax: "/logos/assets/savax.png",
  solvbtc: "/logos/assets/solvbtc.png",
  spcx: "/logos/assets/spcx.svg",
  super: "/logos/assets/super.png",
  tsla: "/logos/assets/tsla.png",
  tsm: "/logos/assets/tsm.png",
  ttwo: "/logos/assets/ttwo.png",
  usdc: "/logos/assets/usdc.png",
  usde: "/logos/assets/usde.png",
  usdt: "/logos/assets/usdt.png",
  wavax: "/logos/assets/wavax.png",
  wbtce: "/logos/assets/wbtce.png",
  wethe: "/logos/assets/wethe.png",
  xaut0: "/logos/assets/xaut0.png",
  xava: "/logos/assets/xava.png",
};

/** Sign-in options on Connect. */
export const BRAND_LOGOS = {
  google: "/logos/brands/google.svg",
  x: "/logos/brands/x.svg",
  core: "/logos/brands/core.svg",
  metamask: "/logos/brands/metamask.svg",
  walletconnect: "/logos/brands/walletconnect.svg",
} as const;

/** Behind a logo (transparent corners, light glyphs): the neutral avatar surface. */
const LOGO_SURFACE = "#1A1A1D";

export const logoOf = (id: string | null | undefined): string | null => (id ? (ASSET_LOGOS[id.toLowerCase()] ?? null) : null);

/** CSS fill that draws an asset's logo in a round avatar, or null when it has none. */
export const logoFill = (id: string | null | undefined): string | null => {
  const logo = logoOf(id);
  return logo ? `${LOGO_SURFACE} url(${logo}) center / cover no-repeat` : null;
};

/**
 * Fields for a reference avatar (port-reference.ts: round span with an initials hole fills from `avBg`): with a
 * logo, the logo and no initials; without, nothing — the avatar keeps its color and initials.
 */
export function logoAvatar(id: string | null | undefined, initialsKey: "ini2" | "ini" = "ini2"): { avBg?: string; ini2?: string; ini?: string } {
  const fill = logoFill(id);
  return fill ? { avBg: fill, [initialsKey]: "" } : {};
}
