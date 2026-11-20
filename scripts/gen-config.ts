/**
 * config/assets.json → generated lists (spec §4). `--check` exits 1 if any file is stale.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ConfigError, findRepoRoot } from "@pantado/shared";
import { generateAll } from "./lib/gen.js";

function main(): number {
  const check = process.argv.includes("--check");
  const root = findRepoRoot();
  const files = generateAll(root);
  let stale = 0;
  for (const [rel, text] of files) {
    const path = join(root, rel);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === text) {
      console.log(`ok       ${rel}`);
      continue;
    }
    if (check) {
      console.error(`stale    ${rel}`);
      stale += 1;
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`written  ${rel}`);
  }
  if (stale) console.error(`${stale} generated file(s) out of date — run \`pnpm gen:config\``);
  return stale ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exitCode = 1;
}
