import pg from 'pg';

async function main() {
  const client = new pg.Client(process.env.DATABASE_URL);
  await client.connect();
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS display_name TEXT,
      ADD COLUMN IF NOT EXISTS avatar_url TEXT
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL
  `);
  console.log('Migration done');
  await client.end();
}

main().catch(console.error);
