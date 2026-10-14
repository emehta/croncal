/**
 * The private-words check. The words live in a file outside this repo
 * (DENYLIST=/path), so committing the check never commits the words.
 *
 * Each word matches as a whole word in any case: "ACME" finds "ACME" but not
 * "acmecorp". A word that starts or ends with something other than a letter
 * or digit ("sb_secret_", "GOCSPX-") matches as a prefix on that side, which
 * is how a key's shape is caught.
 */

import { readFileSync } from "node:fs";

export function loadWords(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isWordChar = (char) => /[A-Za-z0-9]/.test(char);

export function wordPattern(word) {
  const before = isWordChar(word[0]) ? "(?<![A-Za-z0-9])" : "";
  // A key's prefix counts only with a key's length after it, so code that
  // names the prefix ("starts with sb_secret_") is not a leak.
  const after = isWordChar(word[word.length - 1]) ? "(?![A-Za-z0-9])" : "[A-Za-z0-9_\\-]{16,}";
  return new RegExp(`${before}${escape(word)}${after}`, "gi");
}

/** Every hit as { line, word }, in order. */
export function findPrivate(text, words) {
  const hits = [];
  for (const word of words) {
    for (const match of text.matchAll(wordPattern(word))) {
      hits.push({ line: text.slice(0, match.index).split("\n").length, word });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}
