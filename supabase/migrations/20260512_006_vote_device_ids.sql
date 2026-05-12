-- Migration: add hardware_device_id and browser_id to votes table for multi-layer vote integrity

-- Layer 2: Physical device identifier (mobile) — prevents cross-account voting on same hardware
ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS hardware_device_id TEXT;

-- Partial unique index: only enforces uniqueness when the column is set
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_hardware_device
  ON votes (question_id, hardware_device_id)
  WHERE hardware_device_id IS NOT NULL;

-- Layer 3: Browser fingerprint (web) — prevents re-voting from same browser across sessions
ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS browser_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_browser_id
  ON votes (question_id, browser_id)
  WHERE browser_id IS NOT NULL;
