import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot } from "../src/config.js";

export const ROOT = findRepoRoot();

/** Copy the real config into a temp root so a test can mutate one file. */
export function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "pantado-"));
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages: []\n");
  cpSync(join(ROOT, "config"), join(dir, "config"), { recursive: true });
  cpSync(join(ROOT, "contracts/config/params.json"), join(dir, "contracts/config/params.json"));
  return dir;
}

type Json = unknown;

function step(node: Json, key: string): Json {
  if (node === null || typeof node !== "object") throw new Error(`cannot index ${key}`);
  return (node as Record<string, Json>)[key];
}

/** Read the value at a dotted path, e.g. "assets.2.id". */
export function getAt(root: string, rel: string, path: string): Json {
  const v: Json = JSON.parse(readFileSync(join(root, rel), "utf8"));
  return path.split(".").reduce(step, v);
}

/** Set the value at a dotted path in a JSON file under `root`. */
export function setAt(root: string, rel: string, path: string, value: Json): void {
  const file = join(root, rel);
  const v: Json = JSON.parse(readFileSync(file, "utf8"));
  const keys = path.split(".");
  const last = keys.pop();
  if (last === undefined) throw new Error("empty path");
  const parent = keys.reduce(step, v);
  if (parent === null || typeof parent !== "object") throw new Error(`no parent for ${path}`);
  (parent as Record<string, Json>)[last] = value;
  writeFileSync(file, JSON.stringify(v));
}
