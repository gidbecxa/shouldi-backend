/**
 * Migration 006 — vote device IDs
 * Adds hardware_device_id and browser_id to the votes table for cross-account
 * vote deduplication, with partial unique indexes (WHERE NOT NULL) so the
 * constraint only fires when the value is actually present.
 *
 * Run: npx tsx scripts/migrate-006-vote-device-ids.mts
 */
import 'dotenv/config';
import pg from 'pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL env var is required');
  }

  const client = new pg.Client(databaseUrl);
  await client.connect();
  console.log('Connected — running migration 006...');

  try {
    await client.query('BEGIN');

    // Layer 2: physical device identifier (mobile)
    await client.query(`
      ALTER TABLE votes
        ADD COLUMN IF NOT EXISTS hardware_device_id TEXT
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_hardware_device
        ON votes (question_id, hardware_device_id)
        WHERE hardware_device_id IS NOT NULL
    `);

    // Layer 3: browser fingerprint (web)
    await client.query(`
      ALTER TABLE votes
        ADD COLUMN IF NOT EXISTS browser_id TEXT
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_browser_id
        ON votes (question_id, browser_id)
        WHERE browser_id IS NOT NULL
    `);

    await client.query('COMMIT');
    console.log('Migration 006 complete ✓');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration 006 failed:', err);
  process.exit(1);
});
