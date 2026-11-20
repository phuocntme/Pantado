import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

/** Public runtime config comes from src/generated/public-config.json (scripts/public-config.ts). */
const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@pantado/sdk", "@pantado/shared"],
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // workspace packages are TypeScript ESM sources with ".js" specifiers
  webpack: (cfg: { resolve: { extensionAlias?: Record<string, string[]>; alias?: Record<string, string | false | string[]> } }) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    // optional sign-in integrations the auth SDK loads lazily; Pantado uses EVM wallets only
    cfg.resolve.alias = { ...(cfg.resolve.alias ?? {}), "@farcaster/mini-app-solana": false };
    return cfg;
  },
};

export default config;
