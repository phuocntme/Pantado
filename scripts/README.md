# @pantado/scripts

- `gen-config.ts` — `config/assets.json` → `contracts/config/assets.<network>.json`,
  `services/indexer/generated/whitelists.json`, `apps/web/generated/assets.json`.
  `pnpm gen:config` writes; `pnpm gen:config:check` fails if any file is out of date.
- `check-level.ts` (P6), `seed-demo.ts` (P9).
