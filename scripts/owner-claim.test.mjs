/**
 * Making the project's one account, against a fake Supabase that acts out
 * the races: two tabs at once, a create that failed part way, a claim left
 * behind, a recording that loses to another tab.
 *
 * Wrong here is a project with two owners, or one nobody can ever finish
 * setting up, and neither shows until someone is locked out.
 */

import { createOwnerWith, SetupError } from "@/selfhost/server";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
}

/** Just enough of supabase-js's query builder for the setup's queries, over tables in memory. */
function fakeSupabase(state, hooks = {}) {
  const matches = (row, filters) =>
    filters.every(({ column, op, value }) => {
      const field = row[column];
      if (op === "eq") return field === value;
      if (op === "is") return value === null ? field === null || field === undefined : field === value;
      if (op === "lt") return field < value;
      return true;
    });
  function query(table) {
    const plan = { op: "select", filters: [], returning: false, payload: null, count: false };
    const builder = {
      insert(payload) { plan.op = "insert"; plan.payload = payload; return builder; },
      update(payload) { plan.op = "update"; plan.payload = payload; return builder; },
      delete() { plan.op = "delete"; return builder; },
      select(_columns, options) {
        if (plan.op === "select") plan.count = Boolean(options?.count);
        else plan.returning = true;
        return builder;
      },
      eq(column, value) { plan.filters.push({ column, op: "eq", value }); return builder; },
      is(column, value) { plan.filters.push({ column, op: "is", value }); return builder; },
      lt(column, value) { plan.filters.push({ column, op: "lt", value }); return builder; },
      maybeSingle() { plan.single = true; return builder; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    function run() {
      const rows = state[table];
      if (plan.op === "insert") {
        const list = Array.isArray(plan.payload) ? plan.payload : [plan.payload];
        if (table === "app_owner" && rows.length > 0) return { data: null, error: { code: "23505", message: "duplicate key" } };
        for (const row of list) rows.push({ claimed_at: new Date().toISOString(), user_id: null, ...row });
        return { data: null, error: null };
      }
      if (plan.op === "update") {
        if (table === "app_owner" && "user_id" in plan.payload && hooks.beforeRecord) hooks.beforeRecord(state);
        const hit = rows.filter((row) => matches(row, plan.filters));
        for (const row of hit) Object.assign(row, plan.payload);
        return { data: plan.returning ? hit.map((row) => ({ ...row })) : null, error: null };
      }
      if (plan.op === "delete") {
        state[table] = rows.filter((row) => !matches(row, plan.filters));
        return { data: null, error: null };
      }
      const hit = rows.filter((row) => matches(row, plan.filters));
      if (plan.count) return { count: hit.length, data: null, error: null };
      return { data: plan.single ? hit[0] ?? null : hit, error: null };
    }
    return builder;
  }
  return {
    from: query,
    auth: {
      admin: {
        async createUser({ email, app_metadata }) {
          if (hooks.createUserFails) return { data: { user: null }, error: { code: hooks.createUserFails, message: "failed" } };
          if (state.users.some((user) => user.email === email)) return { data: { user: null }, error: { code: "email_exists", message: "already registered" } };
          const user = { id: `user-${state.users.length + 1}`, email, app_metadata };
          state.users.push(user);
          return { data: { user }, error: null };
        },
        async deleteUser(id) {
          state.users = state.users.filter((user) => user.id !== id);
          return { data: null, error: null };
        },
      },
    },
  };
}

const fresh = () => ({ app_owner: [], categories: [], users: [] });
async function attempt(state, hooks, email = "me@example.com") {
  try {
    await createOwnerWith(fakeSupabase(state, hooks), email, "password-1");
    return "ok";
  } catch (error) {
    return error instanceof SetupError ? `${error.status} ${error.message}` : `crash ${error}`;
  }
}

{
  const state = fresh();
  check("a fresh project gets its owner", await attempt(state), "ok");
  check("the owner is recorded", state.app_owner[0]?.user_id, "user-1");
  check("the owner flag is set where only the server can set it", state.users[0]?.app_metadata, { self_host_owner: true });
  check("a second account is refused", (await attempt(state, {}, "other@example.com")).startsWith("409 This project already has its account"), true);
  check("and makes no user", state.users.length, 1);
}

{
  const state = fresh();
  state.app_owner.push({ id: true, user_id: null, claimed_at: new Date().toISOString() });
  check("a claim another tab is using is not taken", (await attempt(state)).startsWith("409 The account is being made in another tab"), true);
  check("and no user is made", state.users.length, 0);
}

{
  const state = fresh();
  state.app_owner.push({ id: true, user_id: null, claimed_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
  check("a claim left behind by a create that failed is taken over", await attempt(state), "ok");
  check("and the owner recorded", state.app_owner[0].user_id, "user-1");
}

{
  const state = fresh();
  state.users.push({ id: "user-0", email: "me@example.com", app_metadata: {} });
  check("an email already in the project is refused in words", (await attempt(state)).startsWith("409 That email already has an account"), true);
  check("and the claim is let go, so another try can start", state.app_owner.length, 0);
}

{
  const state = fresh();
  check("Supabase refusing the account says so", (await attempt(state, { createUserFails: "unexpected" })).startsWith("502 Supabase did not make the account"), true);
  check("and lets the claim go", state.app_owner.length, 0);
}

{
  const state = fresh();
  const result = await attempt(state, {
    beforeRecord(current) {
      // Another tab records its owner first.
      current.users.push({ id: "user-other", email: "other@example.com", app_metadata: { self_host_owner: true } });
      current.app_owner[0].user_id = "user-other";
    },
  });
  check("losing the race to record the owner is a plain 409", result.startsWith("409 Another account was made at the same moment"), true);
  check("the account this tab made is taken away again", state.users.map((u) => u.id), ["user-other"]);
  check("and the other tab's owner stands", state.app_owner[0].user_id, "user-other");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`owner-claim: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`owner-claim: ${passed} passed`);
