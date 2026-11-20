import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, keccak256, parseEther, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { indexFactoryAbi, testERC20Abi, tx } from "@pantado/sdk";
import { ANVIL_KEYS } from "@pantado/sdk/testing";
import { findRepoRoot, type Deployment } from "@pantado/shared";

/** P7 gate: Playwright smoke on Anvil — every screen; create with review, buy, sell, redeem, swap, private → public. */

const root = findRepoRoot();
// the stack (stack.ts, Playwright webServer) writes .stack.json once it is up
let stack = { rpcUrl: "", deployment: "" };
let dep = {} as Deployment;
let pub = createPublicClient({ chain: foundry, transport: http("http://127.0.0.1:1") });
let c = {} as Deployment["contracts"];
function loadStack(): void {
  stack = JSON.parse(readFileSync(join(root, "test/e2e-app/.stack.json"), "utf8")) as typeof stack;
  dep = JSON.parse(readFileSync(stack.deployment, "utf8")) as Deployment;
  pub = createPublicClient({ chain: foundry, transport: http(stack.rpcUrl) });
  c = dep.contracts;
}
const deployer = privateKeyToAccount(ANVIL_KEYS[0]);
const user = privateKeyToAccount(ANVIL_KEYS[1]); // the app's dev wallet (NEXT_PUBLIC_DEV_WALLET_KEY)

async function send(key: Hex, req: { to: Address; data: Hex; value?: bigint }): Promise<void> {
  const account = privateKeyToAccount(key);
  const w = createWalletClient({ account, chain: foundry, transport: http(stack.rpcUrl) });
  await pub.waitForTransactionReceipt({ hash: await w.sendTransaction({ ...req, account, chain: foundry }) });
}
const indexByTicker = (t: string): Promise<Address> =>
  pub.readContract({ address: c.factory, abi: indexFactoryAbi, functionName: "indexByTicker", args: [keccak256(toBytes(t))] });
const balance = (token: Address, who: Address = user.address): Promise<bigint> =>
  pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
async function until(fn: () => Promise<boolean>, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("condition not met");
}

function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  return errs;
}

async function connect(page: Page): Promise<void> {
  await page.goto("/connect");
  await page.locator("[data-connect]").first().click();
  await expect(page.locator("body.in")).toHaveCount(1);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  loadStack();
  // fund the dev wallet once: test USDC (deployer is the owner) + AVAX for gas
  await send(ANVIL_KEYS[0], { to: c.usdc, data: encodeFunctionData({ abi: testERC20Abi, functionName: "mint", args: [user.address, 50_000_000_000n] }) });
  await send(ANVIL_KEYS[0], { to: user.address, data: "0x", value: parseEther("1") });
  void deployer;
});

test("every screen renders without errors", async ({ page }) => {
  const errs = watchErrors(page);
  const tbb = await indexByTicker("TBB");
  const routes: [string, RegExp][] = [
    ["/", /Ask/],
    ["/ask", /Ask/],
    ["/marketplace", /Marketplace/],
    ["/swap", /Swap/],
    ["/create", /Create/],
    ["/portfolio", /Portfolio/],
    ["/profile", /Creator|Profile/],
    ["/connect", /Connect/],
    ["/states", /Error and empty states/],
    ["/asset/nvda", /NVDA/],
    [`/index/${tbb}`, /Tech \+ BTC Balanced/],
    [`/index/${tbb}/review`, /Tech \+ BTC Balanced/],
    [`/version/${tbb}`, /version/i],
    [`/redeem/${tbb}`, /Redeem/],
  ];
  for (const [path, text] of routes) {
    await page.goto(path);
    await expect(page.locator("#app")).toContainText(text);
    await expect(page.locator("nav[aria-label='Main']").first()).toBeVisible(); // left rail on every screen
  }
  // live data reached the Marketplace (seeded public indexes, not the reference's mock rows)
  await page.goto("/marketplace");
  await expect(page.locator("#app")).toContainText("Magnificent 7");
  await expect(page.locator("#app")).not.toContainText("Crypto Beta");
  await expect(page.locator("#app")).not.toContainText("My basket"); // private index never listed
  expect(errs).toEqual([]);
});

test("buy and sell an index from its page", async ({ page }) => {
  await connect(page);
  const tbb = await indexByTicker("TBB");
  await page.goto(`/index/${tbb}`);
  const trade = page.locator("[aria-label='Index stats and trade']");
  await trade.locator("input[type=number]").first().fill("250");
  await page.getByText("Buy index", { exact: false }).first().click();
  await until(async () => (await balance(tbb)) > 0n);
  const units = await balance(tbb);

  await trade.locator("[aria-label='Side']").getByText("Sell", { exact: true }).click();
  await trade.locator("input[type=number]").first().fill(String(Number(units) / 1e18 / 3));
  await page.getByText(/^Sell for/).first().click();
  await until(async () => (await balance(tbb)) < units);
});

test("redeem from Portfolio", async ({ page }) => {
  await connect(page);
  const tbb = await indexByTicker("TBB");
  const before = await balance(tbb);
  expect(before).toBeGreaterThan(0n);
  await page.goto("/portfolio");
  await page.locator(`a[href^='/redeem/' i][href$='${tbb.slice(-8).toLowerCase()}' i]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/redeem/${tbb}`, "i"));
  await page.getByRole("button", { name: /^Redeem / }).first().click();
  await until(async () => (await balance(tbb)) === 0n);
  expect(await balance(dep.assets.nvda as Address)).toBeGreaterThan(0n); // in-kind
});

test("swap with search", async ({ page }) => {
  await connect(page);
  await page.goto("/swap");
  await page.getByRole("button", { name: "Choose token" }).last().click();
  await page.getByPlaceholder("Search ticker or paste contract address").fill(dep.assets.aapl as string);
  await page.getByText("AAPL", { exact: true }).first().click();
  const quoted = page.waitForResponse((r) => r.url().includes("/quote/swap") && r.request().postData()?.includes('"amountIn":"100000000"') === true);
  await page.locator("input[type=number]").first().fill("100");
  await quoted;
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await until(async () => (await balance(dep.assets.aapl as Address)) > 0n);
  // unknown contract address → registry only
  await page.getByRole("button", { name: "Choose token" }).last().click();
  await page.getByPlaceholder("Search ticker or paste contract address").fill("0x000000000000000000000000000000000000bEEF");
  await expect(page.locator("#app")).toContainText("No listed asset at this contract address");
});

test("create with review (one signature), then private → public", async ({ page }) => {
  await connect(page);
  await page.goto(`/create?draft=${Buffer.from(JSON.stringify({ name: "E2E Basket", ticker: "E2EB", description: "e2e", components: ["nvda", "btcb"], weights: [60, 40], mode: "Manual", preset: "custom" })).toString("base64url")}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[aria-label='Account menu']")).toContainText("0x7099");
  await page.locator("[aria-label='Visibility']").getByText("Private", { exact: true }).click();
  const reviewQuote = page.waitForResponse((r) => r.url().includes("/quote/create") && r.request().postData()?.includes('"usdcIn":"100000000"') === true);
  await page.getByText(/^Review: (create|publish) and buy/).click();
  await reviewQuote;
  await expect(page.locator("#app")).toContainText(/nothing is created/i);
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await until(async () => !/^0x0{40}$/.test(await indexByTicker("E2EB")));
  const idx = await indexByTicker("E2EB");
  expect(await balance(idx)).toBeGreaterThan(0n);

  await page.goto("/marketplace");
  await expect(page.locator("#app")).not.toContainText("E2E Basket");
  await page.goto(`/index/${idx}`);
  await expect(page.locator("#app")).toContainText("Only you");
  await page.getByText("Make public", { exact: true }).first().click();
  await until(async () => (await pub.readContract({ address: c.factory, abi: indexFactoryAbi, functionName: "indexInfo", args: [idx] }))[1]);
  await page.goto("/marketplace");
  await expect(page.locator("#app")).toContainText("E2E Basket");
  void tx;
});

test("delete a chat from the Ask history (two presses), gone after reload", async ({ page }) => {
  const errs = watchErrors(page);
  await connect(page);
  // seed two finished conversations into this wallet's history
  await page.evaluate((owner) => {
    const now = Date.now();
    const conv = (id: string, title: string) => ({ id, title, created: now, updated: now, turns: [{ q: title, mode: "auto", text: "ok", cards: [], meta: null, status: "done" }] });
    localStorage.setItem(`pantado-ask:wallet:${owner}`, JSON.stringify([conv("e2e-a", "E2E keep me"), conv("e2e-b", "E2E delete me")]));
  }, user.address.toLowerCase());
  await page.goto("/ask?c=e2e-b");
  const chats = page.locator(".chats");
  await expect(chats).toContainText("E2E delete me");
  const del = page.getByRole("button", { name: "Delete “E2E delete me”" });
  await del.click();
  await expect(chats).toContainText("E2E delete me"); // first press only arms it
  await page.getByRole("button", { name: "Confirm delete “E2E delete me”" }).click();
  await expect(chats).not.toContainText("E2E delete me");
  await expect(chats).toContainText("E2E keep me");
  await expect(page).toHaveURL(/\/ask$/);
  await page.reload();
  await expect(chats).toContainText("E2E keep me");
  await expect(chats).not.toContainText("E2E delete me");
  expect(errs).toEqual([]);
});

test("the Ask home lists saved chats and reopens one", async ({ page }) => {
  const errs = watchErrors(page);
  await page.goto("/");
  await page.waitForFunction(() => localStorage.getItem("pantado-ask-session"));
  await page.evaluate((owner) => {
    const s = JSON.parse(localStorage.getItem("pantado-ask-session") ?? "null") as { id: string };
    const now = Date.now();
    const conv = (id: string, title: string) => ({ id, title, created: now, updated: now, turns: [{ q: title, mode: "auto", text: "ok", cards: [], meta: null, status: "done" }] });
    localStorage.setItem(`pantado-ask:wallet:${owner}`, JSON.stringify([conv("home-a", "E2E home chat"), conv("home-b", "E2E other chat")]));
    // a chat an older build saved without a wallet
    localStorage.setItem(`pantado-ask:anon:${s.id}`, JSON.stringify([conv("anon-a", "E2E anonymous chat")]));
  }, user.address.toLowerCase());
  await page.reload();
  // no wallet: no history at all
  await expect(page.locator(".chats")).toContainText("Connect to see your chats");
  await expect(page.locator(".chats")).not.toContainText("E2E anonymous chat");
  await expect(page.locator(".chats")).not.toContainText("E2E home chat");
  await connect(page);
  await page.goto("/");
  const chats = page.locator(".chats");
  await expect(chats).toContainText("E2E home chat");
  await expect(chats).not.toContainText("E2E anonymous chat"); // never moved into the wallet
  await expect(chats).not.toContainText("Connect to see your chats");
  await page.getByPlaceholder("Search chats").fill("other");
  await expect(chats).not.toContainText("E2E home chat");
  await page.getByRole("button", { name: "E2E other chat" }).click();
  await expect(page).toHaveURL(/\/ask\?c=home-b$/);
  expect(errs).toEqual([]);
});

test("without a wallet, a question in the link is asked (shown, not saved), and Ask agent on an index starts one", async ({ page }) => {
  await page.goto(`/ask?q=${encodeURIComponent("E2E anonymous question about AVAX")}&mode=auto`);
  await expect(page).toHaveURL(/\/ask\?c=/);
  await expect(page.locator("section[aria-label='Conversation']")).toContainText("E2E anonymous question about AVAX");
  await expect(page.locator(".chats")).not.toContainText("E2E anonymous question"); // not listed without a wallet
  const tbb = await indexByTicker("TBB");
  await page.goto(`/index/${tbb}`);
  await expect(page.getByRole("link", { name: "Fork" })).toHaveCount(0);
  await page.getByRole("link", { name: "Ask agent" }).click();
  await expect(page).toHaveURL(/\/ask\?c=/);
  await expect(page.locator("section[aria-label='Conversation']")).toContainText("(TBB)");
});
