/**
 * The nine themes, everywhere a theme has to be named. What is being
 * defended is a theme that half exists: a name in Settings whose block in
 * globals.css is missing a variable (so that one colour falls through to
 * Midnight's), a light theme a light-ground rule forgot, a Delete whose label
 * cannot be read, a reload that flashes the wrong page colour.
 * `npm test -- themes`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { APP_FIRST_PAINT } from "@/lib/first-paint";
import { LIGHT_THEMES, THEME_LABELS, THEME_VALUES } from "@/lib/themes";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("src/app/globals.css");
const failures = [];
let passed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failures.push(detail ? `${name}: ${detail}` : name);
}

/** The custom properties declared in the block opened by `selector`. */
function declaredIn(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return null;
  const block = css.slice(start, css.indexOf("\n}", start));
  return new Set([...block.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
}

// Every theme sets every variable a theme sets. Warm's block is the set the
// dark themes share; Light may add its own on top (its shadows).
const shared = declaredIn('[data-theme="warm"]');
check("Warm's block is found", shared && shared.size > 30, `found ${shared?.size}`);
for (const theme of THEME_VALUES) {
  const vars = declaredIn(`[data-theme="${theme}"]`);
  if (!vars) { failures.push(`${theme}: no [data-theme="${theme}"] block in globals.css`); continue; }
  const missing = [...(shared ?? [])].filter((name) => !vars.has(name));
  check(`${theme} sets every theme variable`, missing.length === 0, `missing ${missing.join(", ")}`);
}

// Every variable the CSS reads is declared somewhere: an undefined var()
// throws out the whole declaration it sits in, silently.
// The global sheets and every CSS module, found rather than listed, so a new one is never missed.
const modules = [];
const findModules = (dir) => {
  for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) findModules(path);
    else if (entry.name.endsWith(".module.css")) modules.push(path);
  }
};
findModules("src");
const sources = ["src/app/fonts/hanken-grotesk.css", "src/app/globals.css", ...modules.sort()];
const declared = new Set();
for (const path of sources) for (const m of read(path).matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
// Written at run time by the shell (AppShell), or handed in inline by the
// element that uses it (--hue, for .ui-hue-ink).
const RUNTIME = new Set(["--app-header-height", "--app-nav-clearance", "--hue"]);
for (const path of sources) {
  const unknown = [...new Set([...read(path).matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]))]
    .filter((name) => !declared.has(name) && !RUNTIME.has(name));
  check(`${path}: every var() without a fallback is declared`, unknown.length === 0, `undeclared ${unknown.join(", ")}`);
}

// An armed Delete reads in every theme: the solid danger fill under its own
// ink, at the 4.5:1 a 12px label needs.
const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const dangerCss = read("src/components/form/DangerFill.module.css");
function dangerPair(theme) {
  const opener = theme === "midnight" ? "\n.fill {" : `:global([data-theme="${theme}"]) .fill {`;
  const start = dangerCss.indexOf(opener);
  if (start < 0) return null;
  const block = dangerCss.slice(start, dangerCss.indexOf("}", start));
  const fill = (block.match(/--danger-fill:\s*(#[0-9a-f]{6});/i) ?? [])[1];
  const ink = (block.match(/--on-danger:\s*(#[0-9a-f]{6});/i) ?? [])[1];
  return fill && ink ? { fill, ink } : null;
}
for (const theme of THEME_VALUES) {
  const pair = dangerPair(theme);
  if (!pair) { failures.push(`${theme}: no danger pair in DangerFill.module.css`); continue; }
  const r = ratio(pair.fill, pair.ink);
  check(`${theme}: a Delete's label on its fill`, r >= 4.5, `${pair.ink} on ${pair.fill} is ${r.toFixed(2)}:1`);
}

// A light theme says so, so its form controls and scrollbars are light too.
for (const theme of LIGHT_THEMES) {
  if (theme === "light") continue;
  const start = css.indexOf(`[data-theme="${theme}"] {`);
  const block = css.slice(start, css.indexOf("\n}", start));
  check(`${theme} is color-scheme light`, /color-scheme:\s*light/.test(block));
}

// Every rule written for Light's ground names every light theme.
for (const path of sources) {
  const source = read(path);
  const forLight = (source.match(/data-theme="light"\][^{,]*[,{]/g) ?? [])
    .filter((rule) => !/^data-theme="light"\] \{/.test(rule)).length;
  for (const theme of LIGHT_THEMES.filter((t) => t !== "light")) {
    const forTheme = (source.match(new RegExp(`data-theme="${theme}"\\][^{,]*[,{]`, "g")) ?? [])
      .filter((rule) => !new RegExp(`^data-theme="${theme}"\\] \\{`).test(rule)).length;
    check(`${path}: ${theme} beside every Light rule`, forTheme >= forLight, `${forLight} for Light, ${forTheme} for ${theme}`);
  }
}

// Labels and first paint.
for (const theme of THEME_VALUES) {
  check(`${theme} has a label`, typeof THEME_LABELS[theme] === "string" && THEME_LABELS[theme].length > 0);
  check(`${theme} has a first-paint colour`, /^#[0-9a-f]{6}$/i.test(APP_FIRST_PAINT[theme] ?? ""));
}

// The pre-paint script is written from the list, not kept by hand.
check("the pre-paint script reads THEME_VALUES", /THEME_VALUES\.filter\(/.test(read("src/app/layout.tsx")));

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`themes: ${passed} passed`);
