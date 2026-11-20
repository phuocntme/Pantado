import { Counter, Gauge, type Registry } from "prom-client";
import { encodeFunctionData, erc20Abi, maxUint256, type Account, type Address } from "viem";
import { priceOracleAbi, rebalancerAbi, testERC20Abi, tx } from "@pantado/sdk";
import { listIndexes, simulateAndSend, type ChainContext, type Logger } from "@pantado/service-kit";
import { fillDecision, type FillConfig } from "./logic.js";

export class AuctionFiller {
  lastOkAt = 0;
  private approved = new Set<string>();
  private readonly m;

  constructor(
    private readonly ctx: ChainContext,
    private readonly account: Account,
    private readonly cfg: FillConfig,
    private readonly log: Logger,
    registry: Registry,
  ) {
    const r = [registry];
    this.m = {
      fills: new Counter({ name: "filler_fills_total", help: "auction fills", labelNames: ["result"], registers: r }),
      edge: new Gauge({ name: "filler_last_edge_bps", help: "edge of the last fill", registers: r }),
      balance: new Gauge({ name: "keeper_balance_avax", help: "keeper native balance", labelNames: ["keeper"], registers: r }),
    };
  }

  private async approveOnce(token: Address, spender: Address): Promise<void> {
    const key = `${token}:${spender}`;
    if (this.approved.has(key)) return;
    const allowance = await this.ctx.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [this.account.address, spender],
    });
    if (allowance < maxUint256 / 2n) {
      const r = await simulateAndSend(this.ctx, this.account, tx.approve(token, spender));
      if (!r.ok) throw r.error;
    }
    this.approved.add(key);
  }

  private async balanceOf(token: Address): Promise<bigint> {
    return this.ctx.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [this.account.address] });
  }

  /** Make sure the filler holds `amount` of `token`, buying it with test USDC through the router. */
  private async acquire(token: Address, amount: bigint): Promise<void> {
    const { contracts: c } = this.ctx.deployment;
    const have = await this.balanceOf(token);
    if (have >= amount) return;
    const need = amount - have;
    // USDC in for `need` out: quote 1 USDC, scale, +3 % headroom for spread and fee
    const [perUsdc] = await this.ctx.reader.quoteSwap(c.usdc, token, 1_000_000n);
    const usdcIn = (need * 1_000_000n * 103n) / (perUsdc * 100n) + 1_000_000n;
    const usdcBal = await this.balanceOf(c.usdc);
    if (usdcBal < usdcIn) {
      const r = await simulateAndSend(this.ctx, this.account, {
        to: c.usdc,
        data: encodeMint(this.account.address, usdcIn - usdcBal),
      });
      if (!r.ok) throw r.error;
    }
    await this.approveOnce(c.usdc, c.swapRouter);
    const r = await simulateAndSend(this.ctx, this.account, tx.swap(c.swapRouter, c.usdc, token, usdcIn, need, this.account.address));
    if (!r.ok) throw r.error;
  }

  /** Sell everything held of `token` back to USDC (keeps the demo filler flat). */
  private async unwind(token: Address): Promise<void> {
    const { contracts: c } = this.ctx.deployment;
    const bal = await this.balanceOf(token);
    if (bal === 0n || token === c.usdc) return;
    await this.approveOnce(token, c.swapRouter);
    const r = await simulateAndSend(this.ctx, this.account, tx.swap(c.swapRouter, token, c.usdc, bal, 0n, this.account.address));
    if (!r.ok) this.log.warn("unwind skipped", { token, code: r.error.code });
  }

  async tick(): Promise<{ index: Address; filled: bigint }[]> {
    const { ctx } = this;
    const { contracts: c } = ctx.deployment;
    const out: { index: Address; filled: bigint }[] = [];
    for (const index of await listIndexes(ctx)) {
      const ps = await ctx.reader.planState(index);
      if (!ps.auctionLive) continue;
      const k = await ctx.reader.basket(index);
      const i = ps.auction.sellIdx;
      const j = ps.auction.buyIdx;
      const ai = k.assets[i];
      const aj = k.assets[j];
      const di = k.decimals[i];
      const dj = k.decimals[j];
      if (!ai || !aj || di === undefined || dj === undefined) continue;
      const [[pI], [pJ], price] = await Promise.all([
        ctx.publicClient.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "latest", args: [ai] }),
        ctx.publicClient.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "latest", args: [aj] }),
        ctx.publicClient.readContract({ address: c.rebalancer, abi: rebalancerAbi, functionName: "currentPrice", args: [index] }),
      ]);
      const d = fillDecision(
        { lot: ps.auction.lot, filled: ps.auction.filled, price, priceI: pI, priceJ: pJ, decI: di, decJ: dj },
        this.cfg,
      );
      if (!d) continue;
      try {
        await this.acquire(aj, d.pay + d.pay / 100n + 1n);
        await this.approveOnce(aj, c.rebalancer);
        const maxPay = d.pay + d.pay / 100n + 1n; // price only falls until the fill lands
        const r = await simulateAndSend(ctx, this.account, tx.fill(c.rebalancer, index, d.amountOut, maxPay));
        this.m.fills.inc({ result: r.ok ? "ok" : r.error.code });
        if (!r.ok) {
          this.log.warn("fill skipped", { index, code: r.error.code, error: r.error.message });
          continue;
        }
        this.m.edge.set(d.edgeBps);
        this.log.info("filled", { index, amountOut: d.amountOut, edgeBps: d.edgeBps, tx: r.hash });
        out.push({ index, filled: d.amountOut });
        await this.unwind(ai);
      } catch (e) {
        this.log.warn("fill failed", { index, error: e instanceof Error ? e.message : String(e) });
      }
    }
    this.m.balance.set({ keeper: "auction-filler" }, Number(await ctx.publicClient.getBalance({ address: this.account.address })) / 1e18);
    this.lastOkAt = Date.now();
    return out;
  }
}

function encodeMint(to: Address, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: testERC20Abi, functionName: "mint", args: [to, amount] });
}
