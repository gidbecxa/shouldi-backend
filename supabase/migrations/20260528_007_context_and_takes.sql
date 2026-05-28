-- Migration: context field on questions, takes table, takes_count counter
-- Date: 2026-05-28

-- 1. Raise question text limit from 120 → 200 characters
ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_text_check;

ALTER TABLE questions
  ADD CONSTRAINT questions_text_check
  CHECK (char_length(text) <= 200);

-- 2. Add optional context field (max 280 chars)
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS context TEXT
  CHECK (context IS NULL OR char_length(context) <= 280);

-- 3. Add takes_count counter column to questions
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS takes_count INTEGER NOT NULL DEFAULT 0;

-- 4. Create takes table
CREATE TABLE IF NOT EXISTS takes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote        TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
  content     TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'flagged', 'deleted')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (question_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_takes_question ON takes(question_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_takes_user ON takes(user_id);

-- 5. Trigger to keep takes_count in sync
CREATE OR REPLACE FUNCTION update_takes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE questions SET takes_count = takes_count + 1 WHERE id = NEW.question_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE questions SET takes_count = takes_count - 1 WHERE id = OLD.question_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'deleted' AND OLD.status != 'deleted' THEN
    UPDATE questions SET takes_count = takes_count - 1 WHERE id = NEW.question_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER takes_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON takes
  FOR EACH ROW EXECUTE FUNCTION update_takes_count();

-- 6. RLS
ALTER TABLE takes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "takes_public_read"
  ON takes FOR SELECT
  USING (status = 'active');

CREATE POLICY "takes_insert_own"
  ON takes FOR INSERT
  WITH CHECK (true); -- anonymous device-id users allowed; server enforces vote check

CREATE POLICY "takes_delete_own"
  ON takes FOR DELETE
  USING (true); -- server enforces ownership via user_id filter
