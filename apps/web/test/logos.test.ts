import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAssets } from "@pantado/shared";
import { ASSET_LOGOS, BRAND_LOGOS, logoAvatar, logoFill } from "../src/lib/logos";
import { interp } from "../src/lib/tpl";

const pub = join(import.meta.dirname, "..", "public");

describe("logos", () => {
  it("every manifest entry is a registry asset with a file in public/logos, and every file is listed", () => {
    const ids = new Set(loadAssets().map((a) => a.id));
    for (const [id, path] of Object.entries(ASSET_LOGOS)) {
      expect(ids.has(id), id).toBe(true);
      expect(existsSync(join(pub, path)), path).toBe(true);
    }
    for (const p of Object.values(BRAND_LOGOS)) expect(existsSync(join(pub, p)), p).toBe(true);
    const files = readdirSync(join(pub, "logos/assets")).map((f) => `/logos/assets/${f}`).sort();
    expect(Object.values(ASSET_LOGOS).sort()).toEqual(files);
  });

  it("SVG logos carry no script, handlers or remote references", () => {
    const svgs = [...Object.values(ASSET_LOGOS), ...Object.values(BRAND_LOGOS)].filter((p) => p.endsWith(".svg"));
    for (const p of svgs) expect(readFileSync(join(pub, p), "utf8"), p).not.toMatch(/<script|\son[a-z]+=|javascript:|href="https?:|<foreignObject/i);
  });

  it("an asset with a logo fills its avatar with it and drops the initials; without one the avatar is unchanged", () => {
    expect(logoFill("btcb")).toBe("#1A1A1D url(/logos/assets/btcb.png) center / cover no-repeat");
    expect(logoAvatar("BTCB")).toEqual({ avBg: logoFill("btcb"), ini2: "" });
    expect(logoAvatar("btcb", "ini")).toEqual({ avBg: logoFill("btcb"), ini: "" });
    expect(logoAvatar(null)).toEqual({});
    // an asset missing from the logo set keeps its color + initials
    const missing = loadAssets().find((a) => !ASSET_LOGOS[a.id]);
    if (missing) expect(logoAvatar(missing.id)).toEqual({});
  });

  it("avatar holes fall back: first value, else the next path, else the literal color", () => {
    expect(interp("background: {{a.avBg|a.dot}}", { a: { avBg: "url(x)", dot: "#111" } })).toBe("background: url(x)");
    expect(interp("background: {{a.avBg|a.dot}}", { a: { dot: "#111" } })).toBe("background: #111");
    expect(interp("background: {{a.avBg|#76B900}}", { a: {} })).toBe("background: #76B900");
  });

  it("generated avatars read the logo fill; bars and charts that share the color keep it", () => {
    const gen = (f: string): string => readFileSync(join(import.meta.dirname, "..", "src/screens/gen", f), "utf8");
    const pf = gen("Portfolio.gen.tsx");
    expect(pf).toContain("background: {{a.avBg|a.dot}}");
    expect(pf).toContain("background: {{a.dot}}"); // allocation bar
    expect(pf).toMatch(/"stroke": A\(lookup\("a\.dot"/); // donut
    expect(gen("Asset.gen.tsx")).toContain("background: {{a.avBg|#76B900}}");
    // the sidebar shortcuts (with their decorative avatar stack) are not shown
    expect(gen("Chat.gen.tsx")).not.toContain("Swap any asset");
  });
});
