#!/usr/bin/env node
/**
 * Takes out of src/app/globals.css what nothing in this app can use: the
 * stylesheet came whole from the source app, with its public site, market
 * ribbon and other pages in it.
 *
 *   node tools/trim-css.mjs          report only
 *   node tools/trim-css.mjs --write  rewrite globals.css
 *
 * A rule goes only when every one of its selectors names a class or a data
 * attribute that appears nowhere else in src/ (a class inside :not() does not
 * count, since :not(.x) matches whether .x exists or not). A custom property
 * goes only when nothing reads it, here or in src/, and it goes from every
 * theme at once, so each theme keeps the same set. Keyframes go when no rule
 * or component runs them. Tailwind's @theme block and the @layer structure
 * are never touched. Repeated until nothing more comes out, because removing
 * a rule can leave the variables only it read.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";

const FILE = "src/app/globals.css";
const WRITE = process.argv.includes("--write");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css|mjs)$/.test(entry) && full !== FILE) out.push(full);
  }
  return out;
}
const elsewhere = walk("src").map((file) => readFileSync(file, "utf8")).join("\n");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordIn = (text, word) => new RegExp(`(?<![\\w-])${escape(word)}(?![\\w-])`).test(text);

const original = readFileSync(FILE, "utf8");
const root = postcss.parse(original);

function insideTheme(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule" && parent.name === "theme") return true;
  }
  return false;
}
function insideKeyframes(node) {
  return node.parent?.type === "atrule" && /keyframes$/.test(node.parent.name);
}

/** Whether a selector could match anything this app renders. */
function selectorLive(selector) {
  const bare = selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, "");
  for (const [, name] of bare.matchAll(/\.([A-Za-z_][\w-]*)/g)) if (!wordIn(elsewhere, name)) return false;
  for (const [, name] of bare.matchAll(/\[(data-[\w-]+)/g)) {
    if (name === "data-theme") continue;
    if (!elsewhere.includes(name)) return false;
  }
  return true;
}

let removedRules = 0;
let removedProps = 0;
let removedKeyframes = 0;
for (let pass = 0; pass < 10; pass += 1) {
  let changed = false;

  root.walkRules((rule) => {
    if (insideTheme(rule) || insideKeyframes(rule)) return;
    const live = rule.selectors.filter(selectorLive);
    if (live.length === rule.selectors.length) return;
    changed = true;
    if (live.length === 0) {
      rule.remove();
      removedRules += 1;
    } else {
      rule.selectors = live;
    }
  });

  const css = root.toString();
  const declared = new Set();
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--") && !insideTheme(decl)) declared.add(decl.prop);
  });
  for (const prop of declared) {
    const reads = (css.match(new RegExp(`var\\(\\s*${escape(prop)}(?![\\w-])`, "g")) ?? []).length;
    if (reads > 0 || elsewhere.includes(prop)) continue;
    root.walkDecls(prop, (decl) => {
      if (!insideTheme(decl)) {
        decl.remove();
        removedProps += 1;
      }
    });
    changed = true;
  }

  const afterProps = root.toString();
  root.walkAtRules(/keyframes$/, (rule) => {
    const name = rule.params.trim();
    const runs = afterProps.split(`@keyframes ${name}`).join("");
    if (wordIn(runs, name) || wordIn(elsewhere, name)) return;
    rule.remove();
    removedKeyframes += 1;
    changed = true;
  });

  root.walkAtRules((rule) => {
    if (rule.name === "media" || rule.name === "supports") {
      if (!rule.nodes?.some((node) => node.type !== "comment")) {
        rule.remove();
        changed = true;
      }
    }
  });
  root.walk((node) => {
    if (node.type === "rule" && !node.nodes?.some((child) => child.type !== "comment")) {
      node.remove();
      changed = true;
    }
  });

  if (!changed) break;
}

// A comment heading nothing but removed rules is removed with them.
root.walkComments((comment) => {
  let next = comment.next();
  while (next && next.type === "comment") next = next.next();
  if (!next) comment.remove();
});

const result = `${root.toString().replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
console.log(`rules ${removedRules}, custom properties ${removedProps}, keyframes ${removedKeyframes}; lines ${original.split("\n").length} -> ${result.split("\n").length}`);
if (WRITE) writeFileSync(FILE, result);
