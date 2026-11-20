import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { Counter, Gauge, type Registry } from "prom-client";
import { encodeFunctionData, getAddress, isAddress, parseEther, type Account, type Address, type Hex } from "viem";
import { testERC20Abi } from "@pantado/sdk";
import type { ChainContext, Logger } from "@pantado/service-kit";
import { parseUnitsExact } from "@pantado/shared";
import type { FundStore } from "./store.js";

export interface FundConfig {
  usdc: string; // whole USDC, decimal string
  avax: string;
  /** gas AVAX for a Privy embedded wallet, once per Privy user; "0" = none */
  embeddedAvax: string;
  secret: string;
  network: string;
  minKeeperAvax: string;
}

export type FundResult =
  | { status: "funded"; address: Address; usdcTx: Hex | null; avaxTx: Hex | null }
  | { status: "already-funded"; address: Address };

export class AutoFunder {
  private readonly m;
  constructor(
    private readonly ctx: ChainContext,
    private readonly account: Account,
    private readonly store: FundStore,
    private readonly cfg: FundConfig,
    private readonly log: Logger,
    registry: Registry,
  ) {
    const r = [registry];
    this.m = {
      funded: new Counter({ name: "autofund_requests_total", help: "fund requests", labelNames: ["result"], registers: r }),
      balance: new Gauge({ name: "keeper_balance_avax", help: "keeper native balance", labelNames: ["keeper"], registers: r }),
    };
  }

  /**
   * Test USDC once per wallet. `embeddedUser` (a Privy user id the API verified from the sign-in token) adds gas AVAX
   * once per Privy user and once per wallet: an embedded wallet has no other way to get gas.
   */
  async fund(raw: string, embeddedUser?: string): Promise<FundResult> {
    if (!isAddress(raw)) throw new FundError(400, "Invalid address");
    const address = getAddress(raw);
    const usdcFirst = await this.usdc(address);
    const gasTx = embeddedUser ? await this.gas(address, embeddedUser) : null;
    if (!usdcFirst && !gasTx) {
      this.m.funded.inc({ result: "already-funded" });
      return { status: "already-funded", address };
    }
    return { status: "funded", address, usdcTx: usdcFirst?.usdcTx ?? null, avaxTx: usdcFirst?.avaxTx ?? gasTx };
  }

  private async gas(address: Address, user: string): Promise<Hex | null> {
    const amount = parseEther(this.cfg.embeddedAvax);
    if (amount === 0n) return null;
    const keys = [`autofund-gas:${this.cfg.network}:user:${user}`, `autofund-gas:${this.cfg.network}:${address.toLowerCase()}`];
    if (!(await this.store.claim(keys[0] ?? ""))) return null;
    if (!(await this.store.claim(keys[1] ?? ""))) {
      await this.store.release(keys[0] ?? "");
      return null;
    }
    try {
      const { ctx, account } = this;
      const tx = await ctx.wallet(account).sendTransaction({ account, chain: ctx.chain, to: address, value: amount });
      const r = await ctx.publicClient.waitForTransactionReceipt({ hash: tx });
      if (r.status !== "success") throw new Error(`gas transfer reverted ${tx}`);
      this.m.funded.inc({ result: "gas" });
      this.log.info("gas sent", { address, tx });
      return tx;
    } catch (e) {
      for (const k of keys) await this.store.release(k);
      this.m.funded.inc({ result: "error" });
      throw new FundError(502, e instanceof Error ? e.message : String(e));
    }
  }

  /** null when this wallet already had its test USDC */
  private async usdc(address: Address): Promise<{ usdcTx: Hex; avaxTx: Hex | null } | null> {
    const key = `autofund:${this.cfg.network}:${address.toLowerCase()}`;
    if (!(await this.store.claim(key))) return null;
    try {
      const { ctx, account } = this;
      const w = ctx.wallet(account);
      const usdcAmount = parseUnitsExact(this.cfg.usdc, 6);
      const usdcTx = await w.sendTransaction({
        account,
        chain: ctx.chain,
        to: ctx.deployment.contracts.usdc,
        data: encodeFunctionData({ abi: testERC20Abi, functionName: "mint", args: [address, usdcAmount] }),
      });
      const r1 = await ctx.publicClient.waitForTransactionReceipt({ hash: usdcTx });
      if (r1.status !== "success") throw new Error(`USDC mint reverted ${usdcTx}`);
      // gas AVAX is optional (users take it from the public faucet; `autoFund.avax` = "0")
      let avaxTx: Hex | null = null;
      if (parseEther(this.cfg.avax) > 0n) {
        avaxTx = await w.sendTransaction({ account, chain: ctx.chain, to: address, value: parseEther(this.cfg.avax) });
        const r2 = await ctx.publicClient.waitForTransactionReceipt({ hash: avaxTx });
        if (r2.status !== "success") throw new Error(`AVAX transfer reverted ${avaxTx}`);
      }
      this.m.funded.inc({ result: "funded" });
      this.log.info("funded", { address, usdcTx, avaxTx });
      return { usdcTx, avaxTx };
    } catch (e) {
      await this.store.release(key); // allow a retry
      this.m.funded.inc({ result: "error" });
      throw new FundError(502, e instanceof Error ? e.message : String(e));
    }
  }

  async health(): Promise<{ ok: boolean; balanceAvax: number }> {
    const bal = Number(await this.ctx.publicClient.getBalance({ address: this.account.address })) / 1e18;
    this.m.balance.set({ keeper: "auto-fund" }, bal);
    return { ok: bal >= Number(this.cfg.minKeeperAvax), balanceAvax: bal };
  }

  authorized(header: string | undefined): boolean {
    const want = Buffer.from(`Bearer ${this.cfg.secret}`);
    const got = Buffer.from(header ?? "");
    return got.length === want.length && timingSafeEqual(got, want);
  }
}

export class FundError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) throw new FundError(413, "Body too large");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new FundError(400, "Invalid JSON");
  }
}

/** HTTP API: POST /fund. Health and metrics are served separately by service-kit. */
export function createFundServer(f: AutoFunder): Server {
  return createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      try {
        if (req.method !== "POST" || req.url !== "/fund") return send(404, { error: "Not found" });
        if (!f.authorized(req.headers.authorization)) return send(401, { error: "Unauthorized" });
        const body = (await readJson(req)) as { address?: unknown; embeddedUser?: unknown };
        const user = typeof body.embeddedUser === "string" && body.embeddedUser.length <= 128 ? body.embeddedUser : undefined;
        send(200, await f.fund(typeof body.address === "string" ? body.address : "", user));
      } catch (e) {
        if (e instanceof FundError) send(e.status, { error: e.message });
        else send(500, { error: "Internal error" });
      }
    })();
  });
}
