#!/usr/bin/env node
/**
 * Copies exactly the files this app uses out of the source app, at one pinned
 * commit, by following imports from the entry files.
 *
 *   SOURCE_REPO=/path/to/source npm run maint:extract            write what is missing
 *   SOURCE_REPO=/path/to/source npm run maint:extract -- --dry   report only
 *
 * The source is read with `git show <commit>:<path>`, never from its working
 * tree, so the run is the same every time and the source is never touched.
 * Imports listed under `cuts` are not followed: each is reported with the
 * file and line that wanted it, which is the work list for replacing it.
 *
 * Writes the files, `extract-manifest.json` (each path and the blob it came
 * from, which a later port merges against) and `extract-report.md`. A file
 * that already exists here is never overwritten; it is reported as changed.
 *
 * DENYLIST=/path/outside/the/repo checks every copied file for private words.
 * Its hits are printed to the terminal only, never written into the repo.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { findPrivate, loadWords } from "./denylist.mjs";

const ROOT = process.cwd();
const DRY = process.argv.includes("--dry");
const config = JSON.parse(readFileSync(path.join(ROOT, "extract.config.json"), "utf8"));
const source = process.env.SOURCE_REPO;
if (!source) {
  console.error("Set SOURCE_REPO to the source app's folder.");
  process.exit(1);
}
const { commit, entries, cuts = {}, ignorePackages = [] } = config;

const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const tracked = new Set(git("ls-tree", "-r", "--name-only", commit).split("\n").filter(Boolean));
const show = (file) => git("show", `${commit}:${file}`);
const blobOf = (file) => git("rev-parse", `${commit}:${file}`).trim();

const CODE = /\.(tsx?|mjs|cjs|jsx?)$/;
const TRY = ["", ".ts", ".tsx", ".js", ".mjs", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

function lineOf(text, position) {
  return text.slice(0, position).split("\n").length;
}

function resolveLocal(specifier, from) {
  let base;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  } else return null;
  for (const ending of TRY) if (tracked.has(base + ending)) return base + ending;
  if (base.endsWith(".js") && tracked.has(base.replace(/\.js$/, ".ts"))) return base.replace(/\.js$/, ".ts");
  return { missing: base };
}

function packageOf(specifier) {
  if (specifier.startsWith("node:") || specifier.startsWith("@/") || specifier.startsWith(".")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function importsOf(file, text) {
  if (CODE.test(file)) {
    return ts.preProcessFile(text, true, true).importedFiles.map((ref) => ({ specifier: ref.fileName, line: lineOf(text, ref.pos) }));
  }
  if (file.endsWith(".css")) {
    const found = [];
    for (const match of text.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)) found.push({ specifier: match[1], line: lineOf(text, match.index) });
    for (const match of text.matchAll(/url\(\s*["']?(\.{1,2}\/[^"')]+)["']?\s*\)/g)) found.push({ specifier: match[1], line: lineOf(text, match.index) });
    return found;
  }
  return [];
}

const files = new Map();
const packages = new Map();
const cutHits = [];
const missing = [];
const queue = [...entries];

while (queue.length > 0) {
  const file = queue.shift();
  if (files.has(file)) continue;
  if (!tracked.has(file)) {
    missing.push({ specifier: file, from: "(entry)", line: 0 });
    continue;
  }
  const text = show(file);
  files.set(file, text);
  for (const { specifier, line } of importsOf(file, text)) {
    const name = packageOf(specifier);
    if (name) {
      if (!specifier.startsWith("next/") || name !== "next") packages.set(name, (packages.get(name) ?? 0) + 1);
      else packages.set("next", (packages.get("next") ?? 0) + 1);
      continue;
    }
    if (specifier.startsWith("node:")) continue;
    if (file.endsWith(".css") && !specifier.startsWith(".")) continue;
    const resolved = resolveLocal(specifier, file);
    if (!resolved) continue;
    if (typeof resolved === "object") {
      missing.push({ specifier, from: file, line });
      continue;
    }
    if (cuts[resolved]) {
      cutHits.push({ target: resolved, from: file, line, reason: cuts[resolved] });
      continue;
    }
    if (!files.has(resolved)) queue.push(resolved);
  }
}

// What the copied code reads and calls, for the schema and the env list.
const scan = (pattern) => {
  const found = new Map();
  for (const [file, text] of files) {
    for (const match of text.matchAll(pattern)) {
      const key = match[1];
      if (!found.has(key)) found.set(key, new Set());
      found.get(key).add(file);
    }
  }
  return found;
};
const envNames = scan(/process\.env(?:\.([A-Z0-9_]+)|\[["']([A-Z0-9_]+)["']\])/g);
const tables = scan(/\.from\(\s*["']([a-z_]+)["']/g);
const rpcs = scan(/\.rpc\(\s*["']([a-z_]+)["']/g);
const routes = scan(/["'`](\/api\/[A-Za-z0-9_\-/[\]]+)/g);
const assets = scan(/["'`](\/[A-Za-z0-9_\-/]+\.(?:png|jpe?g|svg|webp|gif|ico|woff2?|mp4|webm))["'`]/g);

const sourcePackage = JSON.parse(show("package.json"));
const sourceLock = tracked.has("package-lock.json") ? JSON.parse(show("package-lock.json")) : { packages: {} };
const versionOf = (name) => ({
  range: sourcePackage.dependencies?.[name] ?? sourcePackage.devDependencies?.[name] ?? "(not in package.json)",
  locked: sourceLock.packages?.[`node_modules/${name}`]?.version ?? "?",
});

// Write.
const manifest = { commit, files: {} };
const changed = [];
let written = 0;
for (const [file, text] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
  manifest.files[file] = blobOf(file);
  const target = path.join(ROOT, file);
  if (existsSync(target)) {
    if (readFileSync(target, "utf8") !== text) changed.push(file);
    continue;
  }
  if (DRY) continue;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  written += 1;
}

const lines = [];
const section = (title) => lines.push("", `## ${title}`, "");
lines.push("# Extraction report", "", `Source commit \`${commit}\`. ${files.size} files, ${[...files.values()].reduce((n, t) => n + t.split("\n").length, 0)} lines.`);
section("Cut imports (the work list)");
if (cutHits.length === 0) lines.push("None.");
for (const hit of cutHits.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line)) {
  lines.push(`- \`${hit.from}:${hit.line}\` wanted \`${hit.target}\`: ${hit.reason}`);
}
section("Imports that resolve to nothing");
if (missing.length === 0) lines.push("None.");
for (const item of missing) lines.push(`- \`${item.from}:${item.line}\` \`${item.specifier}\``);
section("Packages");
for (const [name] of [...packages].sort()) {
  if (ignorePackages.includes(name)) continue;
  const { range, locked } = versionOf(name);
  lines.push(`- \`${name}\` ${range} (locked ${locked})`);
}
const listing = (title, map) => {
  section(title);
  if (map.size === 0) lines.push("None.");
  for (const [key, where] of [...map].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    lines.push(`- \`${key}\`: ${[...where].sort().map((f) => `\`${f}\``).join(", ")}`);
  }
};
listing("Environment variables read", envNames);
listing("Tables", tables);
listing("RPCs", rpcs);
listing("API routes referenced", routes);
listing("Public assets referenced", assets);
section("Files that differ from this repo's copy");
if (changed.length === 0) lines.push("None.");
for (const file of changed) lines.push(`- \`${file}\``);

if (!DRY) {
  writeFileSync(path.join(ROOT, "extract-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(ROOT, "extract-report.md"), `${lines.join("\n")}\n`);
}

// Private words: terminal only.
const denylistFile = process.env.DENYLIST;
let denyHits = 0;
if (denylistFile) {
  const words = loadWords(denylistFile);
  for (const [file, text] of files) {
    for (const hit of findPrivate(text, words)) {
      denyHits += 1;
      console.log(`denylist: ${file}:${hit.line}  ${hit.word}`);
    }
  }
}

console.log(`${files.size} files (${written} written, ${changed.length} differ), ${cutHits.length} cut imports, ${missing.length} unresolved, ${packages.size} packages${denylistFile ? `, ${denyHits} denylist hits` : ""}.`);
if (DRY) console.log(lines.join("\n"));
if (process.argv.includes("--list")) console.log([...files.keys()].sort().join("\n"));
