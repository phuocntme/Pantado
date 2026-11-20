import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { ConfigError } from "./errors.js";
import { assetsFileSchema, type Asset, type AssetsFile } from "./schemas/assets.js";
import { profileNameSchema, type ProfileName } from "./schemas/common.js";
import { demoIndexesFileSchema, type DemoIndexesFile } from "./schemas/indexes.js";
import { profileSchema, type Profile } from "./schemas/network.js";
import { paramsSchema, type Params } from "./schemas/params.js";
import { servicesSchema, type Services } from "./schemas/services.js";
import { deploymentSchema, type Deployment } from "./schemas/deployments.js";

/** Repo root: `PANTADO_ROOT`, else the nearest ancestor holding `pnpm-workspace.yaml`. */
export function findRepoRoot(start: string = dirname(fileURLToPath(import.meta.url))): string {
  const env = process.env.PANTADO_ROOT;
  if (env) return resolve(env);
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`pnpm-workspace.yaml not found above ${start}`);
    dir = parent;
  }
}

export interface LoadOptions {
  /** Repo root; defaults to `findRepoRoot()`. */
  root?: string;
}

function resolvePath(rel: string, opts: LoadOptions): string {
  return isAbsolute(rel) ? rel : join(opts.root ?? findRepoRoot(), rel);
}

/** Parse `data` with `schema`; throws `ConfigError` listing every issue with its JSON path. */
export function parseConfig<S extends z.ZodType>(schema: S, data: unknown, file: string): z.output<S> {
  const res = schema.safeParse(data);
  if (res.success) return res.data;
  throw new ConfigError(
    file,
    res.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`),
  );
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (e) {
    throw new ConfigError(path, [e instanceof Error ? e.message : String(e)]);
  }
}

export function loadJsonFile<S extends z.ZodType>(schema: S, rel: string, opts: LoadOptions = {}): z.output<S> {
  const path = resolvePath(rel, opts);
  return parseConfig(schema, readJson(path), rel);
}

export const loadAssetsFile = (opts: LoadOptions = {}): AssetsFile =>
  loadJsonFile(assetsFileSchema, "config/assets.json", opts);

export const loadAssets = (opts: LoadOptions = {}): Asset[] => loadAssetsFile(opts).assets;

/** Active profile: argument, else `PANTADO_PROFILE`, else `contest`. */
export function profileName(name?: string): ProfileName {
  const raw = name ?? process.env.PANTADO_PROFILE ?? "contest";
  const res = profileNameSchema.safeParse(raw);
  if (!res.success) throw new ConfigError("PANTADO_PROFILE", [`unknown profile "${raw}"`]);
  return res.data;
}

export function loadProfile(name?: string, opts: LoadOptions = {}): Profile {
  const p = profileName(name);
  const profile = loadJsonFile(profileSchema, `config/networks/${p}.json`, opts);
  if (profile.profile !== p)
    throw new ConfigError(`config/networks/${p}.json`, [`profile field is "${profile.profile}"`]);
  return profile;
}

export const loadServices = (opts: LoadOptions = {}): Services =>
  loadJsonFile(servicesSchema, "config/services.json", opts);

export const loadParams = (opts: LoadOptions = {}): Params =>
  loadJsonFile(paramsSchema, "contracts/config/params.json", opts);

/** Demo indexes, checked against the asset registry. */
export function loadDemoIndexes(opts: LoadOptions = {}): DemoIndexesFile {
  const rel = "config/indexes.contest.json";
  const file = loadJsonFile(demoIndexesFileSchema, rel, opts);
  const ids = new Set(loadAssets(opts).filter((a) => a.kind !== "quote").map((a) => a.id));
  const issues: string[] = [];
  const tickers = new Set<string>();
  for (const ix of file.indexes) {
    if (tickers.has(ix.ticker)) issues.push(`${ix.id}: duplicate ticker ${ix.ticker}`);
    tickers.add(ix.ticker);
    for (const id of Object.keys(ix.components))
      if (!ids.has(id)) issues.push(`${ix.id}: unknown asset ${id}`);
  }
  if (issues.length) throw new ConfigError(rel, issues);
  return file;
}

/** Deployment of the active profile's execution network (`contracts/deployments/<network>.json`). */
export function loadDeployment(profile?: string, opts: LoadOptions = {}): Deployment {
  const p = loadProfile(profile, opts);
  const rel = process.env.PANTADO_DEPLOYMENTS ?? p.execution.deployments;
  return loadJsonFile(deploymentSchema, rel, opts);
}
