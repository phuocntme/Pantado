# Porting the reference UI (apps/web)

The approved UI is `reference/pantado-app.html`. Screens are **generated** from it, never redesigned
(keep layout, copy, type scale, colors and the left rail consistent).

## Pipeline

1. `scripts/port-reference.ts` turns each reference page AST into `src/screens/gen/<Page>.gen.tsx`
   (do not edit generated files). Run: `pnpm --filter @pantado/web port:reference`.
2. The reference's mock view-model logic for each page is extracted to `reference/logic/<route>.js`.
   It is the **spec** for the live view model: same field names, same shapes, same colors and labels.
3. Mock text hard-coded in the AST (names, prices, wallets) is turned into holes by a per-screen binding
   file `scripts/bindings/<route>.ts` → `{ text: { "<literal>": "<vm.path>" }, slots: [...] }`.
   - `text`: whole-word literal → `{{ path }}`; applied to text nodes and attribute values.
   - `slots`: a subtree (e.g. a chart drawn as static `<rect>`s) replaced by `slots[name](scope)` — match
     by attributes, e.g. `{ tag: "svg", attrs: { "aria-label": "Level chart" }, name: "levelChart" }`;
     a key ending in `~` means "contains". Unmatched slots fail generation.
   - `_common.ts` binds the top-bar account chrome (`me.short`, `me.balanceS`) on every screen.
4. A live screen = `src/screens/<route>.vm.ts` (pure view-model builder, unit-testable) +
   `src/screens/<route>.tsx` (client container: data hooks + state) + `app/<path>/page.tsx`.

## Runtime helpers (src/lib — do not change their APIs)

- `tpl.tsx`: generated-code runtime. `Scope = Record<string, unknown>`.
- `api.ts`: `useApi<T>(path, pollMs?)`, `apiGet`, `apiPost`, `ApiRequestError` (typed, UI message).
- `wallet.tsx`: `useWallet()` (`address`, `connect`, `send`, `chainOk`, `switchChain`), `useTx()`
  (`state`: idle/pending/confirmed/failed with `PantadoError.message` for the UI).
- `nav.ts`: `nav(target, scope)`; a view model overrides a reference link with `_href: { IndexDetail: "/index/0x…" }`
  on the scope (top level or a loop item). Also `short(addr)`.
- `chrome.ts`: `useChrome()` → `me` (put it in every view model as `me`).
- `fmt.ts`: `money`, `pct`, `pctCol`, `vol`, `units`, `ago`, `withInitials` (adds `ini2` like the reference).
- `config.ts`: `CONFIG` (profile, chainId, deployment addresses, flags). No addresses or chain ids in code.
- Transactions: build with `tx.*` from `@pantado/sdk` (`approve`, `createAndBuy`, `buy`, `sell`, `redeem`,
  `swap`, `claim`, `makePublic`, `publishVersion`, `requestMode`); send with `useTx().run([...])`.
  Quotes come from the API (`POST /quote/basket|swap|create`), never computed in the browser.

## API (services/api/src/server.ts — read it for exact shapes)

`/assets`, `/assets/search?q=`, `/assets/:id`, `/assets/:id/{candles,pools,trades}`, `/board?kind=`,
`/indexes`, `/indexes/:id`, `/indexes/:id/{composition,transactions,rebalances,holders,levels}`,
`/creators/:address`, `/portfolio/:address`, `/presets?assets=a,b&preset=equal|marketcap|lowvol`,
`POST /quote/basket {index, side, amount, slippageBps?}`, `POST /quote/swap {tokenIn, tokenOut, amountIn}`,
`POST /quote/create {assets, weightsBps, usdcIn}`. Amounts are base-unit strings; prices/levels USD 1e18.

## Rules

- Same copy as the reference except data. Data the system does not have yet renders as "—", never a
  made-up number. Stock data carries "Reference market: Robinhood Chain (on-chain)"; index data the Fuji tag.
- States (spec §12): loading, empty, stale price (buy/sell paused, redeem from Portfolio), per-trade limit,
  venue paused, price sources disagree, tx pending/confirmed/failed, wrong network — reuse the reference's
  own markup for each state where it exists (see `reference/logic/states.js` / the States page).
- TypeScript strict, no `any`. Typed errors shown with their message.

## Agent (services/agent, P8) — contract used by Ask / Ask conversation

`POST {agentUrl}/ask` body `{ message, mode: "auto" | "deep", sessionId }` → Server-Sent Events:
`event: meta` `{ tools: number, ms: number }` · `event: token` `{ text }` (answer text delta) ·
`event: card` `{ kind: "asset" | "draft" | "index" | "compare", data }` · `event: done` `{}` · `event: error` `{ message }`.
`POST {agentUrl}/draft` `{ prompt }` → `{ name, ticker, description, components: string[], weights: number[], preset, mode, rationale }`.
"Create from this" opens `/create?draft=<base64url JSON of the draft>` pre-filled. The agent never signs.
