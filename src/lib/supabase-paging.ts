/**
 * Reading a table that can outgrow one response.
 *
 * PostgREST caps a single response at 1000 rows (Supabase's `db.max_rows`),
 * and it does it silently: an unbounded `.select()` over a bigger table comes
 * back with 1000 rows, no error, and no indication that there were more. Any
 * aggregate built on top of that is quietly wrong, which is worse than slow.
 */

/** The page size, and the row count at which PostgREST truncates. */
export const SUPABASE_PAGE_SIZE = 1000;

/**
 * The slice of the Supabase query builder this needs.
 *
 * Structural rather than the real `PostgrestFilterBuilder`, because the call
 * sites hand over partially-built queries of several different shapes and the
 * real type would force a cast at each one.
 */
export type RangeQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
};

/**
 * Read every row a query matches, one page at a time.
 *
 * `buildQuery` is called per page rather than taking a built query, because a
 * Supabase query builder is single-use: `.range()` on the same instance twice
 * sends the second request with both ranges applied.
 *
 * **Order the query.** LIMIT/OFFSET paging over an unordered select has no
 * stable row order between requests: Postgres is free to return the same row
 * on two pages and none on a third. Order by something unique, or by something
 * non-unique plus a unique tiebreaker.
 */
export async function fetchAllRows<T>(buildQuery: () => RangeQuery<T>): Promise<T[]> {
  const rows: T[] = [];

  for (let offset = 0; ; offset += SUPABASE_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}
