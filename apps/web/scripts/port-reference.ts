/**
 * Generates src/screens/gen/<Page>.gen.tsx from reference/pantado-app.html (screen-by-screen port).
 * Each generated screen renders exactly the reference AST against a view model `v`; live view models are built
 * in src/screens/<page>.tsx. Also writes reference/logic/<page>.js — the reference view-model logic, kept as the
 * spec for each live view model. Run: pnpm --filter @pantado/web port:reference
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBindings, type Binding, type SlotMatch } from "./bindings.js";

const BINDINGS = await loadBindings();

type Node = string | [string, Record<string, string>, Node[]];

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "reference/pantado-app.html"), "utf8");

const WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
const HAS_HOLE = /\{\{/;
const SVG_CAMEL: Record<string, string> = { viewbox: "viewBox", preserveaspectratio: "preserveAspectRatio" };
const ATTR: Record<string, string> = { class: "className", for: "htmlFor", maxlength: "maxLength", tabindex: "tabIndex", readonly: "readOnly", colspan: "colSpan", rowspan: "rowSpan" };
const BOOL_ATTRS = new Set(["checked", "disabled", "selected", "open", "required", "readonly"]);
const DROP = (a: string): boolean => a.startsWith("hint-");
const VOID = new Set(["input", "img", "col", "br", "hr"]);

const pascal = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const jsStr = (s: string): string => JSON.stringify(s);

function attrName(tag: string, a: string, svg: boolean): string {
  if (SVG_CAMEL[a]) return SVG_CAMEL[a];
  if (ATTR[a]) return ATTR[a];
  if (a.startsWith("aria-") || a.startsWith("data-")) return a;
  if (svg && a.includes("-")) return a.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  void tag;
  return a;
}

/** JS expression for an attribute or text value in scope `s`. */
function valueExpr(v: string, sc: string): string {
  const w = WHOLE.exec(v);
  if (w) return `lookup(${jsStr(w[1] ?? "")}, ${sc})`;
  if (HAS_HOLE.test(v)) return `interp(${jsStr(v)}, ${sc})`;
  return jsStr(v);
}

let counter = 0;

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Apply text bindings: literal → {{ path }} (whole-word, longest first). */
function bindText(s: string, b: Binding): string {
  const entries = Object.entries(b.text ?? {}).sort((x, y) => y[0].length - x[0].length);
  let out = s;
  for (const [lit, path] of entries) {
    const re = new RegExp(`(^|[^A-Za-z0-9_.$])${escRe(lit)}(?![A-Za-z0-9_])`, "g");
    out = out.replace(re, (_m, pre: string) => `${pre}{{ ${path} }}`);
  }
  return out;
}

function matches(node: [string, Record<string, string>, Node[]], m: SlotMatch): boolean {
  if (m.tag && node[0] !== m.tag) return false;
  if (m.text !== undefined && !(node[2].length === 1 && typeof node[2][0] === "string" && node[2][0].trim() === m.text)) return false;
  if (
    m.childText !== undefined &&
    !node[2].some((k) => typeof k !== "string" && k[2].length === 1 && typeof k[2][0] === "string" && k[2][0].trim() === m.childText)
  )
    return false;
  return Object.entries(m.attrs).every(([k, v]) => (k.endsWith("~") ? (node[1][k.slice(0, -1)] ?? "").includes(v) : node[1][k] === v));
}

const slotUse = new Map<string, number>();

/** Rewrite the AST with bindings; slots become ["sc-slot", {name}, []]. */
function bind(node: Node, b: Binding): Node {
  if (typeof node === "string") return bindText(node, b);
  const [tag, attrs, kids] = node;
  for (const m of b.slots ?? []) {
    if (matches(node, m)) {
      slotUse.set(m.name, (slotUse.get(m.name) ?? 0) + 1);
      return ["sc-slot", { name: m.name }, []];
    }
  }
  const a2: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) a2[k] = k === "style" || k === "d" || k === "viewbox" ? v : bindText(v, b);
  const k2 = kids.map((k) => bind(k, b));
  if (a2.style) a2.style = avatarFill(a2.style, k2);
  return [tag, a2, k2];
}

/**
 * A round avatar whose only content is an initials hole (`{{x.ini2}}` / `{{x.ini}}`) takes its fill from `x.avBg`
 * when the view model sets one (the asset's logo, src/lib/logos.ts), else the reference fill: `background: {{x.dot}}`
 * → `{{x.avBg|x.dot}}`, `background: #76B900` → `{{x.avBg|#76B900}}`. Bars and charts sharing `x.dot` keep the color.
 */
function avatarFill(style: string, kids: Node[]): string {
  if (!/border-radius: 50%/.test(style) || kids.length !== 1 || typeof kids[0] !== "string") return style;
  const ini = /^\{\{\s*([\w.]+)\.(ini2|ini)\s*\}\}$/.exec(kids[0].trim());
  if (!ini) return style;
  const owner = ini[1] as string;
  return style.replace(/background: (\{\{\s*([\w.]+)\s*\}\}|#[0-9A-Fa-f]{3,8})/, (_m, _v: string, path: string | undefined) => `background: {{${owner}.avBg|${path ?? _v}}}`);
}

function gen(node: Node, sc: string, svg: boolean, indent: string): string {
  if (typeof node === "string") {
    if (!HAS_HOLE.test(node)) return `${indent}{${jsStr(node)}}`;
    const w = WHOLE.exec(node);
    return w ? `${indent}{T(lookup(${jsStr(w[1] ?? "")}, ${sc}))}` : `${indent}{interp(${jsStr(node)}, ${sc})}`;
  }
  const [tag, attrs, kids] = node;
  const k2 = (s2: string, svg2: boolean): string => kids.map((k) => gen(k, s2, svg2, `${indent}  `)).join("\n");
  if (tag === "sc-for") {
    const listPath = WHOLE.exec(attrs.list ?? "")?.[1] ?? "";
    const as = attrs.as ?? "item";
    const s2 = `s${++counter}`;
    return `${indent}{list(lookup(${jsStr(listPath)}, ${sc})).map((it, i) => { const ${s2} = child(${sc}, ${jsStr(as)}, it, i); return (\n${indent}  <Fragment key={i}>\n${k2(s2, svg)}\n${indent}  </Fragment>); })}`;
  }
  if (tag === "sc-slot") return `${indent}{slot(${jsStr(attrs.name ?? "")}, ${sc})}`;
  if (tag === "sc-if") {
    const cond = WHOLE.exec(attrs.value ?? "")?.[1] ?? "false";
    return `${indent}{bool(lookup(${jsStr(cond)}, ${sc})) && (\n${indent}  <>\n${k2(sc, svg)}\n${indent}  </>)}`;
  }
  const isSvg = svg || tag === "svg";
  const props: string[] = [];
  let href: string | null = null;
  const hasOnChange = "onchange" in attrs;
  const dyn: string[] = [];
  for (const [a, v] of Object.entries(attrs)) {
    if (DROP(a)) continue;
    if (a === "style") {
      props.push(`style={css(${valueExpr(v, sc)})}`);
      continue;
    }
    if (a === "onclick") {
      props.push(`onClick={H(${valueExpr(v, sc)})}`);
      continue;
    }
    if (a === "onchange") {
      props.push(`onChange={HI(${valueExpr(v, sc)})}`);
      continue;
    }
    if (a === "href") {
      href = v;
      continue;
    }
    if (a === "value" && (tag === "input" || tag === "textarea")) {
      props.push(`${hasOnChange ? "value" : "defaultValue"}={T(${valueExpr(v, sc)})}`);
      continue;
    }
    if (BOOL_ATTRS.has(a)) {
      const name = a === "checked" && !hasOnChange ? "defaultChecked" : (ATTR[a] ?? a);
      props.push(`${name}={bool(${valueExpr(v, sc)})}`);
      continue;
    }
    const n = attrName(tag, a, isSvg);
    const NUMERIC = new Set(["rows", "cols", "maxLength", "colSpan", "rowSpan", "tabIndex", "span"]);
    if (!HAS_HOLE.test(v)) props.push(NUMERIC.has(n) && /^-?[0-9]+$/.test(v) ? `${n}={${v}}` : `${n}=${jsStr(v)}`);
    else dyn.push(`${jsStr(n)}: A(${valueExpr(v, sc)})`);
  }
  if (href !== null) {
    const m = /^(\w+)\.dc\.html$/.exec(href);
    if (m) props.push(`href={nav(${jsStr(m[1] ?? "")}, ${sc})}`);
    else props.push(`href={T(${valueExpr(href, sc)}).replace(/^(\\w+)\\.dc\\.html$/, (_m, p: string) => nav(p as LinkTarget, ${sc}))}`);
  }
  if (dyn.length) props.push(`{...P({ ${dyn.join(", ")} })}`);
  if (tag === "textarea") {
    const text = kids.filter((k): k is string => typeof k === "string").join("");
    if (text) props.push(`${hasOnChange ? "value" : "defaultValue"}={${valueExpr(text, sc)}}`);
    return `${indent}<textarea ${props.join(" ")} />`;
  }
  const open = `<${tag}${props.length ? " " + props.join(" ") : ""}`;
  if (kids.length === 0 && (VOID.has(tag) || isSvg)) return `${indent}${open} />`;
  if (kids.length === 0) return `${indent}${open}></${tag}>`;
  return `${indent}${open}>\n${k2(sc, isSvg)}\n${indent}</${tag}>`;
}

const pages: { route: string; title: string; name: string }[] = [];
const re = /PAGES\["(\w+)"\] = \{ title: "([^"]*)", ast: /g;
for (let m = re.exec(html); m; m = re.exec(html)) {
  const route = m[1] ?? "";
  const title = m[2] ?? "";
  const start = m.index + m[0].length;
  const end = html.indexOf(", C: (function", start);
  const binding = BINDINGS[route] ?? {};
  const ast = bind(JSON.parse(html.slice(start, end)) as Node, binding);
  for (const m of binding.slots ?? []) if (!slotUse.get(m.name)) throw new Error(`${route}: slot ${m.name} matched nothing`);
  const logicEnd = html.indexOf("return Component; })() };", end);
  const logic = html.slice(end + ", C: ".length, logicEnd + "return Component; })()".length);
  const name = pascal(route);
  counter = 0;
  const body = gen(ast, "v", false, "    ");
  const src = `// GENERATED by scripts/port-reference.ts from reference/pantado-app.html — do not edit.
/* eslint-disable */
"use client";
import { Fragment, type ReactNode } from "react";
import { A, P, bool, child, css, H, HI, interp, list, lookup, T, type LinkTarget, type Scope } from "../../lib/tpl";

export const title = ${jsStr(title)};

export function ${name}Screen({
  v,
  nav,
  slots = {},
}: {
  v: Scope;
  nav: (target: LinkTarget, scope: Scope) => string;
  slots?: Record<string, (scope: Scope) => ReactNode>;
}) {
  const slot = (name: string, s: Scope): ReactNode => slots[name]?.(s) ?? null;
  void A; void P; void HI; void H; void child; void list; void bool; void interp; void T;
  return (
${body}
  );
}
`;
  const out = join(root, "src/screens/gen", `${name}.gen.tsx`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, src);
  writeFileSync(join(root, "reference/logic", `${route}.js`), `// Reference view-model logic for "${title}" (extracted, for porting only).\n${logic}\n`);
  pages.push({ route, title, name });
}
console.log(`generated ${pages.length} screens:`, pages.map((p) => p.route).join(", "));
