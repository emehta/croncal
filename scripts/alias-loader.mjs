/**
 * Lets a plain `node` test import app modules by their `@/…` alias.
 *
 * Node strips the types out of a .ts file on its own, so a test needs no build
 * step, but it does not read tsconfig, so `@/lib/foo` means nothing to it and
 * the extension the alias omits has to be put back.
 *
 * Register it from the test:
 *
 *   node --import ./scripts/alias-loader.mjs scripts/whatever.test.mjs
 *
 * A module imported this way must write its type-only imports as
 * `import type { … }`. Node erases types but cannot know that a plain
 * `import { SomeType }` was one, so it looks for a runtime export that is not
 * there and the import fails.
 */

import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(dirname(fileURLToPath(import.meta.url))), "src");

export async function resolve(specifier, context, next) {
  /*
   * A relative import with the extension left off, which Next's loader
   * allows and Node's does not. Put it back, so a test can load a module the
   * way Next does.
   */
  if (/^\.\.?\//.test(specifier) && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    const path = fileURLToPath(new URL(specifier, context.parentURL));
    for (const extension of [".ts", ".tsx"]) {
      if (existsSync(path + extension)) return next(pathToFileURL(path + extension).href, context);
    }
  }

  /*
   * Next's entry points ("next/server") have no exports map, so Node's ESM
   * loader wants the file's own name. The proxy imports "next/server" the
   * way the bundler allows; a test loads it the way Node does.
   */
  if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);

  if (!specifier.startsWith("@/")) return next(specifier, context);

  let path = join(SRC, specifier.slice(2));
  if (!existsSync(path)) {
    for (const extension of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(path + extension)) {
        path += extension;
        break;
      }
    }
  }

  return next(pathToFileURL(path).href, context);
}

// Importing this file both registers the hook and exposes `resolve` to it.
register(import.meta.url);
