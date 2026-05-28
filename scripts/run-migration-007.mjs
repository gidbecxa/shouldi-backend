// One-off script: apply migration 007 (context + takes)
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set in .env");

const sql = readFileSync(
  join(__dirname, "../supabase/migrations/20260528_007_context_and_takes.sql"),
  "utf8"
);

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  console.log("Connected to database.");
  await client.query(sql);
  console.log("Migration 007 applied successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
