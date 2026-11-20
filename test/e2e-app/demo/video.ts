/**
 * Records the demo video's scenes from the running Fuji stack (`pnpm tsx demo/video.ts <outDir> [scene…]`).
 * Each scene is captured as sharp JPEG frames through the Chrome screencast (with timestamps) plus named marks,
 * written to <outDir>/<scene>/frames + marks.json; demo/edit.ts cuts and joins them. Real transactions on Fuji from
 * demo wallet 1 (DEMO_WALLET_1, testnet only). A fake cursor and an English caption bar are drawn into the page.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { attachDemoWallet } from "./wallet.js";

const APP = process.env.APP_URL ?? "http://localhost:4002";
const API = process.env.API_URL ?? "http://localhost:3201";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const out = resolve(process.argv[2] ?? "video-raw");
const only = new Set(process.argv.slice(3));

const VIEW = { width: 1600, height: 900 };
const SCALE = 1.2; // frames are 1920 × 1080

/** Cursor dot and caption bar, injected into every page (a plain string: no compiler helpers in the page). */
const OVERLAY = `(() => {
  const css = \`#demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 0 0 2px rgba(144,82,249,.9),0 4px 14px rgba(0,0,0,.5);z-index:2147483647;pointer-events:none;transition:transform .12s}
  #demo-cursor.down{transform:scale(.7)}
  #demo-cap{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:1300px;padding:14px 26px;border-radius:14px;background:rgba(11,11,13,.86);border:1px solid rgba(144,82,249,.55);color:#F2F2F3;font:600 26px/1.35 Inter,system-ui,sans-serif;text-align:center;z-index:2147483646;pointer-events:none;opacity:0;transition:opacity .35s}
  #demo-cap.on{opacity:1}\`;
  const add = () => {
    if (location.protocol === 'file:' || document.getElementById('demo-cursor')) return;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    const c = document.createElement('div'); c.id = 'demo-cursor'; document.body.appendChild(c);
    const k = document.createElement('div'); k.id = 'demo-cap'; document.body.appendChild(k);
    const p = window.__demoPos || { x: 800, y: 450 }; c.style.left = p.x + 'px'; c.style.top = p.y + 'px';
    if (window.__demoCap) { k.textContent = window.__demoCap; k.classList.add('on'); }
  };
  document.addEventListener('mousemove', (e) => { const c = document.getElementById('demo-cursor'); window.__demoPos = { x: e.clientX, y: e.clientY }; if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; } }, true);
  document.addEventListener('mousedown', () => document.getElementById('demo-cursor')?.classList.add('down'), true);
  document.addEventListener('mouseup', () => document.getElementById('demo-cursor')?.classList.remove('down'), true);
  window.__setCap = (t) => { window.__demoCap = t; const k = document.getElementById('demo-cap'); if (!k) return; if (t) { k.textContent = t; k.classList.add('on'); } else k.classList.remove('on'); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: true });
})();`;

interface Scene {
  name: string;
  run: (s: Rec) => Promise<void>;
}

class Rec {
  marks: Record<string, number> = {};
  private t0 = Date.now();
  constructor(readonly page: Page) {}
  /** marks are wall-clock seconds, the same clock as the screencast frames' timestamps */
  mark(name: string): void {
    this.marks[name] = Date.now() / 1000;
    console.log(`  · ${name} @ ${((Date.now() - this.t0) / 1000).toFixed(1)}s`);
  }
  async cap(text: string | null): Promise<void> {
    await this.page.evaluate((t) => (window as unknown as { __setCap: (x: string | null) => void }).__setCap(t), text);
  }
  async wait(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
  async moveTo(l: Locator): Promise<void> {
    const b = await l.boundingBox();
    if (!b) throw new Error("not visible");
    const to = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await this.page.mouse.move(to.x, to.y, { steps: 28 });
  }
  async click(l: Locator): Promise<void> {
    await l.scrollIntoViewIfNeeded();
    await this.moveTo(l);
    await this.wait(250);
    await this.page.mouse.down();
    await this.wait(90);
    await this.page.mouse.up();
  }
  async type(l: Locator, text: string): Promise<void> {
    await this.click(l);
    await l.fill("");
    await this.page.keyboard.type(text, { delay: 45 });
  }
  async scroll(dy: number, ms = 1200): Promise<void> {
    const steps = 30;
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, dy / steps);
      await this.wait(ms / steps);
    }
  }
}

const indexId = async (ticker: string): Promise<string> => {
  const board = (await (await fetch(`${API}/board`)).json()) as { id: string; kind: string; symbol: string }[];
  const r = board.find((x) => x.kind === "index" && x.symbol === ticker);
  if (!r) throw new Error(`no index ${ticker}`);
  return r.id;
};

async function connect(page: Page): Promise<void> {
  await page.goto(`${APP}/connect`);
  await page.getByRole("button", { name: /Core/ }).first().click();
  await page.waitForSelector("body.in", { state: "attached", timeout: 30_000 });
}

/** Wait for the open conversation's newest answer to finish (its follow-ups appear last). */
async function answered(page: Page, timeout = 180_000): Promise<void> {
  await page.getByText("Related", { exact: true }).last().waitFor({ timeout });
}

const SCENES: Scene[] = [
  {
    name: "intro",
    run: async (s) => {
      const src = readFileSync(join(HERE, "intro.html"), "utf8")
        .replaceAll("LOGOS/", `file://${ROOT}/apps/web/public/logos/assets/`)
        .replaceAll("BRAND/", `file://${ROOT}/brand/`);
      const tmp = join(out, "intro.page.html");
      writeFileSync(tmp, src);
      await s.page.goto(`file://${tmp}`);
      s.mark("start");
      await s.wait(12_500);
      s.mark("end");
    },
  },
  {
    name: "market",
    run: async (s) => {
      await s.page.goto(`${APP}/marketplace`);
      await s.page.getByText("Avalanche Blue Chips").first().waitFor({ timeout: 60_000 });
      await s.wait(1500);
      s.mark("start");
      await s.cap("10 community indexes · 25 tokenized stocks · 35 Avalanche tokens, live prices");
      await s.wait(1800);
      await s.scroll(700, 2600);
      await s.wait(800);
      s.mark("end");
    },
  },
  {
    name: "ask",
    run: async (s) => {
      await s.page.goto(`${APP}/`);
      await s.page.getByPlaceholder(/Ask about a token/).waitFor({ timeout: 60_000 });
      await s.wait(1200);
      s.mark("start");
      await s.cap("Ask: research any stock or token with live on-chain data");
      await s.type(s.page.getByPlaceholder(/Ask about a token/), "What is NVDA trading at, and how has it moved this month?");
      await s.wait(400);
      s.mark("send");
      await s.page.keyboard.press("Enter");
      await s.page.getByText(/tools? ·/).first().waitFor({ timeout: 60_000 });
      s.mark("firstToken");
      await answered(s.page);
      s.mark("answered");
      await s.cap("Every number comes from a tool call, checked before it is shown");
      await s.wait(2500);
      const trade = s.page.getByRole("link", { name: /^Trade NVDA/ }).first();
      await trade.scrollIntoViewIfNeeded();
      await s.wait(1500);
      await s.cap("One tap from the answer to the trade");
      s.mark("toTrade");
      await s.click(trade);
      await s.page.waitForURL(/\/asset\//, { timeout: 30_000 });
      await s.wait(4000);
      s.mark("end");
    },
  },
  {
    name: "draft",
    run: async (s) => {
      await s.page.goto(`${APP}/`);
      await s.page.getByPlaceholder(/Ask about a token/).waitFor({ timeout: 60_000 });
      await s.wait(1000);
      s.mark("start");
      await s.cap("Ask the agent to build an index");
      await s.click(s.page.getByRole("button", { name: "Deep", exact: true }).first());
      await s.type(s.page.getByPlaceholder(/Ask about a token/), "Build an index of AI chip stocks plus Bitcoin, with a backtest and the main risks.");
      await s.wait(300);
      s.mark("send");
      await s.page.keyboard.press("Enter");
      await s.page.getByText(/tools? ·/).first().waitFor({ timeout: 120_000 });
      s.mark("firstToken");
      await answered(s.page, 240_000);
      s.mark("answered");
      const view = s.page.getByRole("link", { name: "View", exact: true }).last();
      await view.scrollIntoViewIfNeeded();
      await s.cap("Assets, weights, a backtest and the risks, drafted in one answer");
      await s.wait(3500);
      await s.scroll(-500, 1500);
      await s.wait(2500);
      await s.scroll(500, 1500);
      await s.wait(1000);
      s.mark("toCreate");
      await s.cap("View opens the draft in Create");
      await s.click(view);
      await s.page.waitForURL(/\/create/, { timeout: 30_000 });
      await s.wait(3000);
      s.mark("end");
      // keep the draft link for the create scene
      writeFileSync(join(out, "draft-url.txt"), s.page.url());
    },
  },
  {
    name: "create",
    run: async (s) => {
      let url = `${APP}/create`;
      try {
        url = readFileSync(join(out, "draft-url.txt"), "utf8").trim();
      } catch {
        /* no draft recorded: start empty */
      }
      await s.page.goto(url);
      await s.page.getByText("Basket", { exact: true }).first().waitFor({ timeout: 60_000 });
      await s.wait(2500);
      s.mark("start");
      await s.cap("Three weighting presets, then fine-tune by hand");
      for (const p of ["Equal", "Market cap", "Low volatility"]) {
        await s.click(s.page.getByRole("button", { name: p, exact: true }).first());
        await s.wait(1600);
      }
      s.mark("presets");
      const ticker = `AIB${String(Date.now()).slice(-3)}`;
      await s.type(s.page.getByPlaceholder("TICKER"), ticker);
      writeFileSync(join(out, "ticker.txt"), ticker);
      await s.wait(500);
      await s.cap("Publish to the marketplace: creators earn 0.20% of every trade");
      await s.click(s.page.locator("[aria-label='Visibility']").getByText("Public", { exact: true }));
      await s.wait(1200);
      s.mark("review");
      await s.click(s.page.getByText(/^Review: (create|publish) and buy/).first());
      await s.page.getByRole("button", { name: "Confirm in wallet" }).waitFor({ timeout: 60_000 });
      await s.cap("Review: fees, units at level 100, and nothing is created if any purchase fails");
      await s.wait(3500);
      s.mark("confirm");
      await s.click(s.page.getByRole("button", { name: "Confirm in wallet" }));
      await s.page.getByText(/^Published /).first().waitFor({ timeout: 180_000 });
      s.mark("created");
      await s.cap("Created and bought in one transaction on Avalanche");
      await s.wait(5000);
      s.mark("end");
    },
  },
  {
    name: "buy",
    run: async (s) => {
      await s.page.goto(`${APP}/index/${await indexId("AVBLU")}`);
      const trade = s.page.locator("[aria-label='Index stats and trade']");
      await trade.locator("input[type=number]").first().waitFor({ timeout: 60_000 });
      await s.wait(2500);
      s.mark("start");
      await s.cap("Buy an index: pay USDC, receive one token backed by every asset");
      await s.click(s.page.getByRole("button", { name: "More" }).first()).catch(() => undefined);
      await s.wait(2500);
      await s.type(trade.locator("input[type=number]").first(), "500");
      await s.wait(1500);
      s.mark("buy");
      await s.click(s.page.getByText("Buy index", { exact: false }).first());
      await s.cap("One transaction. If any purchase fails, everything reverts");
      await s.page.getByText(/^You bought /).first().waitFor({ timeout: 180_000 });
      s.mark("bought");
      await s.wait(4000);
      await s.cap("Exit any time: sell for USDC, or redeem the assets themselves, free");
      await s.click(s.page.locator("[aria-label='Side']").getByText("Sell", { exact: true }).first()).catch(() => undefined);
      await s.wait(3000);
      s.mark("end");
    },
  },
  {
    name: "portfolio",
    run: async (s) => {
      await s.page.goto(`${APP}/portfolio`);
      await s.page.getByText("Index positions").first().waitFor({ timeout: 60_000 });
      await s.wait(3000);
      s.mark("start");
      await s.cap("Portfolio: positions, PnL, drift and creator earnings");
      await s.wait(2500);
      await s.scroll(500, 1800);
      await s.wait(1500);
      await s.page.goto(`${APP}/index/${await indexId("AVBLU")}`);
      await s.page.getByText("Rebalances", { exact: true }).first().waitFor({ timeout: 60_000 });
      await s.wait(1500);
      await s.cap("Every weight change is recorded, under notice and loss guards");
      await s.click(s.page.getByText("Rebalances", { exact: true }).first());
      await s.wait(1500);
      await s.scroll(450, 1200);
      await s.wait(3000);
      s.mark("end");
    },
  },
];

async function record(ctx: BrowserContext, page: Page, scene: Scene): Promise<void> {
  const dir = join(out, scene.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "frames"), { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  let n = 0;
  cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    const file = `f${String(n++).padStart(6, "0")}.jpg`;
    writeFileSync(join(dir, "frames", file), Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  const rec = new Rec(page);
  const wall0 = Date.now() / 1000;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  try {
    await scene.run(rec);
  } finally {
    await cdp.send("Page.stopScreencast").catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
  writeFileSync(join(dir, "marks.json"), JSON.stringify({ wall0, frames, marks: rec.marks }, null, 1));
  console.log(`scene ${scene.name}: ${frames.length} frames`);
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  await ctx.addInitScript(OVERLAY);
  await attachDemoWallet(page, "DEMO_WALLET_1");
  await connect(page);
  for (const scene of SCENES) {
    if (only.size && !only.has(scene.name)) continue;
    console.log(`recording ${scene.name}`);
    await page.evaluate(() => (window as unknown as { __setCap?: (x: string | null) => void }).__setCap?.(null)).catch(() => undefined);
    await record(ctx, page, scene);
  }
  await browser.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
