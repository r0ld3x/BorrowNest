// BorrowNest Stage 2: API boundary checks with user-scoped Supabase clients.
//
// Uses only the publishable key and real sign-ins, exactly like the app and
// any attacker with a browser. No secret or service-role key is involved.
//
// Prerequisites (see docs/stage-2-setup.md):
//   - migrations applied to the project
//   - five confirmed test accounts; the admin promoted with
//     supabase/operator/promote-admin.sql
//
// Usage:
//   node --env-file=.env.local --env-file=.env.test scripts/verify-boundaries.mjs
//
// .env.test (git-ignored) holds TEST_<NAME>_EMAIL / TEST_<NAME>_PASSWORD for
// RENTER_A, RENTER_B, PROVIDER_A, PROVIDER_B, ADMIN.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
}

const newClient = () =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(name) {
  const email = process.env[`TEST_${name}_EMAIL`];
  const password = process.env[`TEST_${name}_PASSWORD`];
  if (!email || !password) throw new Error(`Missing TEST_${name}_EMAIL / TEST_${name}_PASSWORD`);
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${name}: ${error.code ?? error.message}`);
  return { client, id: data.user.id };
}

const isDenied = (error) => Boolean(error) && (error.code === "42501" || /permission denied/i.test(error.message));

// --- Anonymous -------------------------------------------------------------
const anon = newClient();
for (const table of ["profiles", "products", "product_images", "product_pickup_details"]) {
  const { data, error } = await anon.from(table).select("*").limit(1);
  check(`anon cannot read ${table}`, isDenied(error) || (Array.isArray(data) && data.length === 0), error?.code ?? `${data?.length} rows`);
}
{
  const { data, error } = await anon.rpc("published_products");
  const leaked = (data ?? []).some((row) => "moderation_reason" in row || "provider_id" in row || "exact_address" in row);
  check("anon catalogue works and exposes only safe columns", !error && !leaked, error?.code ?? `${data?.length ?? 0} rows`);
}
{
  const { error } = await anon.rpc("is_active_admin");
  check("private helpers are not callable through the API", Boolean(error), error?.code);
}

// --- Signed-in users --------------------------------------------------------
const users = {};
for (const name of ["RENTER_A", "RENTER_B", "PROVIDER_A", "PROVIDER_B", "ADMIN"]) {
  users[name] = await signIn(name);
}

for (const name of ["RENTER_A", "RENTER_B", "PROVIDER_A", "PROVIDER_B"]) {
  const { client, id } = users[name];
  const { data: profiles } = await client.from("profiles").select("id, role");
  check(`${name} sees only their own profile`, profiles?.length === 1 && profiles[0].id === id);

  const { error: roleError } = await client.from("profiles").update({ role: "admin" }).eq("id", id);
  check(`${name} cannot change their own role`, isDenied(roleError), roleError?.code);

  const { error: statusError } = await client.from("profiles").update({ account_status: "active" }).eq("id", id);
  check(`${name} cannot change their own account status`, isDenied(statusError), statusError?.code);

  const { data: pickup } = await client.from("product_pickup_details").select("product_id, products!inner(provider_id)");
  const foreignPickup = (pickup ?? []).filter((row) => row.products?.provider_id !== id);
  check(`${name} reads no other provider's pickup details`, foreignPickup.length === 0);

  const { error: insertError } = await client.from("products").insert({
    provider_id: id, title: "Boundary test", category: "other", condition: "new", price_per_day: 1, area: "Lashkar",
  });
  check(`${name} cannot insert products (Stage 2)`, isDenied(insertError), insertError?.code);

  const { error: imageError } = await client.from("product_images").insert({ product_id: id, storage_path: "x", sort_order: 0 });
  check(`${name} cannot insert image metadata (Stage 2)`, isDenied(imageError), imageError?.code);
}

{
  const a = users.RENTER_A;
  const { data } = await a.client.from("profiles").update({ full_name: "Hijacked" }).eq("id", users.RENTER_B.id).select("id");
  check("RENTER_A cannot rename RENTER_B", (data ?? []).length === 0);
  const { data: other } = await a.client.from("profiles").select("id").eq("id", users.RENTER_B.id);
  check("RENTER_A cannot read RENTER_B's profile", (other ?? []).length === 0);
  const { data: products } = await a.client.from("products").select("id");
  check("RENTER_A sees no rows in the products table", (products ?? []).length === 0);
}

for (const [name, other] of [["PROVIDER_A", "PROVIDER_B"], ["PROVIDER_B", "PROVIDER_A"]]) {
  const { client, id } = users[name];
  const { data } = await client.from("products").select("id, provider_id, listing_status");
  const foreign = (data ?? []).filter((row) => row.provider_id !== id);
  check(`${name} reads only their own listings (none of ${other}'s drafts)`, foreign.length === 0, `${data?.length ?? 0} own rows`);
}

{
  const { client } = users.ADMIN;
  const { data } = await client.from("profiles").select("id");
  const expected = Object.values(users).map((u) => u.id);
  check("ADMIN can inspect application profiles", expected.every((id) => data?.some((row) => row.id === id)));
  const { error } = await client.from("profiles").update({ role: "provider" }).eq("id", users.RENTER_A.id);
  check("ADMIN cannot change roles through the API (deferred)", isDenied(error), error?.code);
}

for (const { client } of Object.values(users)) await client.auth.signOut();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
