"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPublicClient, createWalletClient, custom, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toPantadoError, type PantadoError, type TxRequest } from "@pantado/sdk";
import { chain } from "./chain";
import { CONFIG, networkNames } from "./config";
import { PrivyCtx, type Eip1193, type SocialMethod } from "./privy";

export { chain };

export type TxState = { status: "idle" } | { status: "pending"; hash?: Hex } | { status: "confirmed"; hash: Hex } | { status: "failed"; error: PantadoError };

export type ConnectMethod = "injected" | "dev" | { social: SocialMethod; email?: string };

export interface WalletCtx {
  address: Address | null;
  kind: "injected" | "dev" | "privy" | null;
  chainOk: boolean;
  /** Google, X and email sign-in go through Privy when it is configured. */
  socialEnabled: boolean;
  connect(method?: ConnectMethod): Promise<void>;
  disconnect(): void;
  switchChain(): Promise<void>;
  /** Send and wait for the receipt; throws PantadoError with UI copy on revert. */
  send(req: TxRequest): Promise<Hex>;
  pub: PublicClient;
}

const Ctx = createContext<WalletCtx | null>(null);
const KEY = "pantado-in";

export function WalletProvider({ children }: { children: ReactNode }) {
  // Fuji blocks are ~2 s: poll receipts every second (viem default is 4 s)
  const pub = useMemo(() => createPublicClient({ chain, transport: http(CONFIG.rpc), pollingInterval: 1_000 }) as PublicClient, []);
  const [address, setAddress] = useState<Address | null>(null);
  const [kind, setKind] = useState<WalletCtx["kind"]>(null);
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const eth = (): Eip1193 | null => (typeof window !== "undefined" ? ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null) : null);
  // dev key: local Anvil only (Playwright). Never on a public chain.
  const devAccount = useMemo(() => (CONFIG.devWalletKey && CONFIG.chainId === 31337 ? privateKeyToAccount(CONFIG.devWalletKey as Hex) : null), []);
  const privy = useContext(PrivyCtx);
  // a social sign-in resolves when Privy hands over the embedded wallet
  const pendingSocial = useRef<{ resolve: () => void } | null>(null);
  const [wantPrivy, setWantPrivy] = useState(false);

  const connect = useCallback(
    async (method?: ConnectMethod) => {
      if (typeof method === "object") {
        if (!privy) throw new Error("Sign-in with Google, X or email is not set up here. Connect a wallet instead.");
        setWantPrivy(true);
        try {
          sessionStorage.setItem(KEY, "privy");
        } catch {
          /* storage unavailable */
        }
        if (privy.wallet) return; // already signed in: the effect below adopts the wallet
        await new Promise<void>((resolve) => {
          pendingSocial.current = { resolve };
          privy.login(method.social, method.email);
        });
        return;
      }
      const m = method ?? (eth() ? "injected" : devAccount ? "dev" : "injected");
      if (m === "dev" && devAccount) {
        setAddress(devAccount.address);
        setKind("dev");
        setWalletChain(CONFIG.chainId);
      } else {
        const p = eth();
        if (!p) throw new Error("No wallet found. Install a browser wallet to connect.");
        const [a] = (await p.request({ method: "eth_requestAccounts" })) as Address[];
        const id = Number(await p.request({ method: "eth_chainId" }));
        setAddress(a ?? null);
        setKind("injected");
        setWalletChain(id);
        p.on?.("chainChanged", (c) => setWalletChain(Number(c)));
        p.on?.("accountsChanged", (accs) => setAddress(((accs as Address[])[0] ?? null) as Address | null));
      }
      try {
        sessionStorage.setItem(KEY, m);
      } catch {
        /* storage unavailable */
      }
    },
    [devAccount, privy],
  );

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(KEY);
    } catch {
      saved = null;
    }
    if (saved === "dev" || saved === "injected") void connect(saved).catch(() => undefined);
    if (saved === "privy") setWantPrivy(true);
    // connect only on mount; later changes come from the wallet events
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // adopt the Privy wallet once signed in (also restores a session after reload)
  const privyAddress = privy?.wallet?.address ?? null;
  useEffect(() => {
    if (!wantPrivy || !privyAddress) return;
    setAddress(privyAddress);
    setKind("privy");
    setWalletChain(CONFIG.chainId);
    pendingSocial.current?.resolve();
    pendingSocial.current = null;
  }, [wantPrivy, privyAddress]);

  useEffect(() => {
    document.body.classList.toggle("in", address !== null);
  }, [address]);

  // first sign-in on the test network: the auto-fund keeper mints test USDC once (spec §12). Gas AVAX: browser wallets
  // take it from the public faucet; a Privy embedded wallet gets a little once, against its sign-in token.
  const embedded = kind === "privy" && privy?.wallet?.embedded === true;
  useEffect(() => {
    if (!address || kind === "dev" || !CONFIG.flags.autoFundOnSignIn) return;
    const key = `pantado-funded:${embedded ? "v2:" : ""}${CONFIG.chainId}:${address.toLowerCase()}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* storage unavailable: the keeper funds a wallet once anyway */
    }
    void (embedded && privy ? privy.accessToken() : Promise.resolve(null))
      .then((privyToken) =>
        fetch(`${CONFIG.apiUrl}/fund`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(privyToken ? { address, privyToken } : { address }) }),
      )
      .then((r) => {
        if (!r.ok && r.status !== 404) localStorage.removeItem(key); // retry on the next sign-in
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per wallet; `privy` changes identity on every render
  }, [address, kind, embedded]);

  const disconnect = useCallback(() => {
    if (kind === "privy") void privy?.logout();
    setWantPrivy(false);
    setAddress(null);
    setKind(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, [kind, privy]);

  const switchChain = useCallback(async () => {
    const p = eth();
    if (!p) return;
    const hex = `0x${CONFIG.chainId.toString(16)}`;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch {
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hex, chainName: networkNames(CONFIG.network).walletName, rpcUrls: [CONFIG.rpc], nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, blockExplorerUrls: [CONFIG.explorer] }],
      });
    }
  }, []);

  const send = useCallback(
    async (req: TxRequest): Promise<Hex> => {
      if (!address) throw new Error("Connect a wallet first.");
      try {
        await pub.call({ account: address, to: req.to, data: req.data, value: req.value }); // simulate: typed revert before signing
        let hash: Hex;
        if (kind === "dev" && devAccount) {
          const w = createWalletClient({ account: devAccount, chain, transport: http(CONFIG.rpc) });
          hash = await w.sendTransaction({ to: req.to, data: req.data, value: req.value, account: devAccount, chain });
        } else {
          const p = kind === "privy" && privy?.wallet ? await privy.wallet.provider() : eth();
          if (!p) throw new Error("No wallet found.");
          const w = createWalletClient({ chain, transport: custom(p) });
          hash = await w.sendTransaction({ to: req.to, data: req.data, value: req.value, account: address, chain });
        }
        const rc = await pub.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") throw new Error("Transaction failed.");
        return hash;
      } catch (e) {
        throw toPantadoError(e);
      }
    },
    [address, kind, devAccount, pub, privy],
  );

  const value: WalletCtx = {
    address,
    kind,
    chainOk: walletChain === null || walletChain === CONFIG.chainId,
    socialEnabled: privy !== null,
    connect,
    disconnect,
    switchChain,
    send,
    pub,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("WalletProvider missing");
  return c;
}

/** Run a tx and track pending / confirmed / failed (spec §12 states). */
export function useTx(): { state: TxState; run: (reqs: TxRequest[]) => Promise<Hex | null>; reset: () => void } {
  const w = useWallet();
  const [state, setState] = useState<TxState>({ status: "idle" });
  const run = useCallback(
    async (reqs: TxRequest[]) => {
      setState({ status: "pending" });
      try {
        let last: Hex | null = null;
        for (const r of reqs) last = await w.send(r);
        if (last) setState({ status: "confirmed", hash: last });
        return last;
      } catch (e) {
        setState({ status: "failed", error: toPantadoError(e) });
        return null;
      }
    },
    [w],
  );
  return { state, run, reset: () => setState({ status: "idle" }) };
}
