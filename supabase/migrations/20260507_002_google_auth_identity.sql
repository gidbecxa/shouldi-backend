ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_sub TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

UPDATE users
SET email = lower(email)
WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique
ON users (google_sub)
WHERE google_sub IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_ci
ON users ((lower(email)))
WHERE email IS NOT NULL;
