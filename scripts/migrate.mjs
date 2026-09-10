#!/usr/bin/env node
// Applies every not-yet-applied file in supabase/migrations/ directly against
// the project's Postgres database, tracked in a `schema_migrations` table —
// replacing "copy this file into the Supabase SQL editor by hand," which is
// exactly the kind of manual step that let migration 034 go unapplied and
// surface as a runtime "Could not find the table" error instead of a build-
// time failure. Every migration in this project is written idempotently
// (create table/policy if not exists, on conflict do nothing, drop
// constraint if exists before re-adding it), so re-running an
// already-applied file is a safe no-op — this script leans on that rather
// than trying to guess which ones already ran on a project that predates
// schema_migrations existing at all; it just applies anything not yet
// recorded, in filename order, and records each as it succeeds.
//
// Usage:
//   DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" npm run migrate
// or drop DATABASE_URL into .env.local (this script reads it the same way
// Next.js does) and just run `npm run migrate`.
//
// Get the connection string from Supabase → Project Settings → Database →
// Connection string ("URI"). Use the direct connection (port 5432), not the
// pgbouncer transaction-mode pooler (port 6543) — this script wraps each
// migration file in its own multi-statement transaction, which pgbouncer's
// transaction-pooling mode doesn't reliably support.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

// Minimal .env.local loader — avoids adding a `dotenv` dependency just for
// this one script. Doesn't override anything already set in the real
// environment (e.g. by CI).
function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is not set.\n\n" +
        "Get it from Supabase → Project Settings → Database → Connection string\n" +
        '("URI", direct connection on port 5432 — not the pooler). Set it in\n' +
        ".env.local or the environment, then run this again."
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const { rows: appliedRows } = await client.query("select filename from schema_migrations");
    const applied = new Set(appliedRows.map((r) => r.filename));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log("Nothing to apply — schema_migrations already covers every file in supabase/migrations.");
      return;
    }

    console.log(`Applying ${pending.length} migration(s):\n  ${pending.join("\n  ")}\n`);

    for (const file of pending) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`→ ${file} ... `);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        console.log("applied");
      } catch (err) {
        await client.query("rollback");
        console.log("FAILED");
        throw err;
      }
    }

    console.log("\nAll migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message ?? err);
  process.exit(1);
});
