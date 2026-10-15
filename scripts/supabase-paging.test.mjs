/**
 * Reading every row of a table (src/lib/supabase-paging.ts), against a fake
 * query that answers ranges the way PostgREST does, with its row cap.
 */

import { SUPABASE_PAGE_SIZE, fetchAllRows } from "@/lib/supabase-paging";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
}

/** A table of `total` rows behind a cap of `cap` rows per response. */
function table(total, cap) {
  const rows = Array.from({ length: total }, (_, index) => index);
  const asked = [];
  const build = () => ({
    range: async (from, to) => {
      asked.push([from, to]);
      return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
    },
  });
  return { rows, asked, build };
}

const empty = table(0, SUPABASE_PAGE_SIZE);
check("an empty table is no rows, after one request", [await fetchAllRows(empty.build), empty.asked.length], [[], 1]);

const small = table(3, SUPABASE_PAGE_SIZE);
check("a small table is every row", await fetchAllRows(small.build), small.rows);

const exact = table(SUPABASE_PAGE_SIZE * 2, SUPABASE_PAGE_SIZE);
check("a table of exactly two pages is every row", (await fetchAllRows(exact.build)).length, SUPABASE_PAGE_SIZE * 2);

const capped = table(1234, 500);
const read = await fetchAllRows(capped.build);
check("a project capped below the page size still gives every row", read.length, 1234);
check("in order, none twice", read.every((value, index) => value === index), true);
check("each page starts where the last ended", capped.asked.map(([from]) => from), [0, 500, 1000, 1234]);

let thrown = null;
try {
  await fetchAllRows(() => ({ range: async () => ({ data: null, error: new Error("denied") }) }));
} catch (error) {
  thrown = error;
}
check("an error is thrown, not read as the end", thrown?.message, "denied");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`supabase-paging: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`supabase-paging: ${passed} passed`);
