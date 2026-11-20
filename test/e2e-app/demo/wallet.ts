/**
 * Demo recording harness: a browser wallet (window.ethereum) backed by a Fuji testnet demo key, so scripted
 * screenshots and the demo video show real transactions. Keys come from `.env` (DEMO_WALLET_N, testnet only);
 * the key never enters the page: signing happens in Node through exposed functions.
 */
import type { Page } from "@playwright/test";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { executionRpcs, loadProfile } from "@pantado/shared";

export async function attachDemoWallet(page: Page, keyEnv: string): Promise<`0x${string}`> {
  const key = process.env[keyEnv];
  if (!key) throw new Error(`${keyEnv} is not set`);
  const profile = loadProfile("contest");
  if (profile.execution.chainId !== avalancheFuji.id) throw new Error("demo wallet: Fuji only");
  const account = privateKeyToAccount(key as Hex);
  const rpc = executionRpcs(profile, "writes")[0]?.url ?? "";
  const pub = createPublicClient({ chain: avalancheFuji, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: avalancheFuji, transport: http(rpc) });

  await page.exposeFunction("__demoRpc", async (method: string, params: unknown[]): Promise<unknown> => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return `0x${avalancheFuji.id.toString(16)}`;
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return null;
      case "eth_sendTransaction": {
        const t = (params[0] ?? {}) as { to: Hex; data?: Hex; value?: Hex; gas?: Hex };
        const hash = await wallet.sendTransaction({ account, to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined });
        return hash;
      }
      case "personal_sign":
        return account.signMessage({ message: { raw: params[0] as Hex } });
      default:
        return pub.request({ method: method as never, params: params as never });
    }
  });
  // a plain string: a bundled function would carry the compiler's helpers into the page
  await page.addInitScript(`(() => {
    const listeners = {};
    window.ethereum = {
      isMetaMask: false,
      request: ({ method, params }) => window.__demoRpc(method, params || []),
      on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    };
  })();`);
  return account.address;
}
