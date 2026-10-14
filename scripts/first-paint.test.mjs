/**
 * The reload colours, and the key the pre-paint script reads.
 *
 * The script in app/layout.tsx runs before the stylesheet, so it carries its
 * own copy of each theme's page colour (lib/first-paint) and its own spelling
 * of the theme's storage key. Both are copies, and a copy drifts: the key was
 * once imported from a client module and arrived as `undefined`, so every
 * reload came up Midnight whatever the theme. This holds both to the source.
 */

import { readFileSync } from "node:fs";
import { APP_FIRST_PAINT } from "@/lib/first-paint";
import { THEME_VALUES } from "@/lib/themes";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (actual === expected) passed += 1;
  else failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const layout = readFileSync("src/app/layout.tsx", "utf8");
const theme = readFileSync("src/lib/theme.ts", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

const layoutKey = layout.match(/const THEME_KEY = "([^"]+)"/)?.[1];
const themeKey = theme.match(/THEME_STORAGE_KEY = "([^"]+)"/)?.[1];
check("the layout reads the key lib/theme writes", layoutKey, themeKey);
check("the layout spells the key rather than importing it from a client module", /import \{[^}]*THEME_STORAGE_KEY/.test(layout), false);

for (const value of THEME_VALUES) {
  const block = value === "midnight" ? /:root,\s*\[data-theme="midnight"\]\s*\{([\s\S]*?)\n\}/ : new RegExp(`\\[data-theme="${value}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`);
  const pageBg = css.match(block)?.[1].match(/--page-bg:\s*([^;]+);/)?.[1].trim();
  check(`${value}: the first frame is the theme's --page-bg`, APP_FIRST_PAINT[value], pageBg);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`first-paint: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`first-paint: ${passed} passed`);
