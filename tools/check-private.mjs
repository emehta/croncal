#!/usr/bin/env node
/**
 * Checks every file this repo would publish for private words.
 *
 *   DENYLIST=/path/outside/the/repo node tools/check-private.mjs           the working tree
 *   DENYLIST=/path/outside/the/repo node tools/check-private.mjs --history every commit
 *
 * The words stay in their own file outside the repo (tools/denylist.mjs).
 * Hits go to the terminal only. Exits non-zero on any hit, so it can stand in
 * front of a commit or a push. Without DENYLIST it says so and passes: a
 * contributor without the list is not stopped.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findPrivate, loadWords } from "./denylist.mjs";

const list = process.env.DENYLIST;
if (!list) {
  console.log("check-private: no DENYLIST set, skipped.");
  process.exit(0);
}
const words = loadWords(list);
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

let hits = 0;
const report = (where, text) => {
  // A copyright line names its author on purpose.
  const scanned = text.replace(/^.*\bCopyright\b.*$/gm, "");
  for (const hit of findPrivate(scanned, words)) {
    hits += 1;
    console.log(`${where}:${hit.line}  ${hit.word}`);
  }
};

if (process.argv.includes("--history")) {
  report("history", git("log", "-p", "--all", "--format=%s%n%b"));
} else {
  const files = git("ls-files", "--cached", "--others", "--exclude-standard").split("\n").filter(Boolean);
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    report(file, text);
  }
}

console.log(hits === 0 ? "check-private: clean." : `check-private: ${hits} hit(s).`);
process.exit(hits === 0 ? 0 : 1);
