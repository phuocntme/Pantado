"use client";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { useMemo, type ReactNode } from "react";
import type { Address } from "viem";
import { chain } from "./chain";
import { CONFIG } from "./config";
import { PrivyCtx, type Eip1193, type PrivyBridge } from "./privy";

function Bridge({ children }: { children: ReactNode }) {
  const p = usePrivy();
  const { wallets } = useWallets();
  // the embedded wallet first; an external wallet linked through Privy otherwise
  const w = p.authenticated ? (wallets.find((x) => x.walletClientType === "privy") ?? wallets[0] ?? null) : null;
  const value = useMemo<PrivyBridge>(
    () => ({
      ready: p.ready,
      authenticated: p.authenticated,
      login: (method, email) => p.login({ loginMethods: [method], ...(method === "email" && email ? { prefill: { type: "email", value: email } } : {}) }),
      logout: () => p.logout(),
      accessToken: () => p.getAccessToken().catch(() => null),
      wallet: w
        ? {
            address: w.address as Address,
            embedded: w.walletClientType === "privy",
            provider: async () => {
              await w.switchChain(CONFIG.chainId).catch(() => undefined);
              return (await w.getEthereumProvider()) as Eip1193;
            },
          }
        : null,
    }),
    [p, w],
  );
  return <PrivyCtx.Provider value={value}>{children}</PrivyCtx.Provider>;
}

export function PrivyRoot({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["google", "twitter", "email", "passkey"],
        appearance: { theme: "dark", accentColor: "#9052F9" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}
