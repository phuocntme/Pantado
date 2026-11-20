/**
 * Screenshots of the running Fuji stack for the pitch deck (`pnpm tsx demo/shots.ts <outDir>`).
 * Connects demo wallet 1 (DEMO_WALLET_1) through the demo harness; asks the live agent two questions.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { attachDemoWallet } from "./wallet.js";

const APP = process.env.APP_URL ?? "http://localhost:4002";
const API = process.env.API_URL ?? "http://localhost:3201";
const out = process.argv[2] ?? "shots";
mkdirSync(out, { recursive: true });

const indexId = async (ticker: string): Promise<string> => {
  const board = (await (await fetch(`${API}/board`)).json()) as { id: string; kind: string; symbol: string }[];
  const r = board.find((x) => x.kind === "index" && x.symbol === ticker);
  if (!r) throw new Error(`no index ${ticker}`);
  return r.id;
};

async function shot(page: Page, name: string): Promise<void> {
  await page.mouse.move(5, 5);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log("shot", name);
}

/** Ask a question in the live app and wait for the answer and its follow-ups. */
async function ask(page: Page, q: string, mode: "auto" | "deep"): Promise<void> {
  await page.goto(`${APP}/ask?q=${encodeURIComponent(q)}&mode=${mode}`);
  await page.getByText("Related", { exact: true }).last().waitFor({ timeout: 150_000 });
  await page.waitForTimeout(1500);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  const page = await ctx.newPage();
  const me = await attachDemoWallet(page, "DEMO_WALLET_1");
  console.log("wallet", me);

  await page.goto(`${APP}/connect`);
  await page.getByRole("button", { name: /Core/ }).first().click();
  await page.waitForSelector("body.in", { state: "attached", timeout: 30_000 });

  await page.goto(`${APP}/`);
  await page.waitForTimeout(6000);
  await shot(page, "ask-home");

  await ask(page, "How is NVDA doing lately, and is it worth holding?", "auto");
  await shot(page, "ask-nvda");

  await ask(page, "Build me an index of AI chip stocks plus Bitcoin, about 6 assets, with a backtest and the main risks.", "deep");
  await shot(page, "ask-draft");

  await page.goto(`${APP}/marketplace`);
  await page.waitForTimeout(6000);
  await shot(page, "marketplace");

  await page.goto(`${APP}/index/${await indexId("AVDEX")}`);
  await page.waitForTimeout(7000);
  await shot(page, "index-avdex");

  await page.goto(`${APP}/create`);
  await page.waitForTimeout(5000);
  await shot(page, "create");

  await page.goto(`${APP}/portfolio`);
  await page.waitForTimeout(8000);
  await shot(page, "portfolio");

  await browser.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
