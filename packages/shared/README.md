# @pantado/shared

Types, zod schemas and loaders for every config file in the repo.

- `loadAssets()` — `config/assets.json` (spec §4)
- `loadProfile(name?)` — `config/networks/<profile>.json`, default `PANTADO_PROFILE`
- `loadServices()` — `config/services.json`
- `loadParams()` — `contracts/config/params.json`
- Generated-file schemas used by `scripts/gen-config.ts`
