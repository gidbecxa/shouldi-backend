-- Add language column to questions table for i18n support
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

ALTER TABLE questions
  ADD CONSTRAINT IF NOT EXISTS questions_language_check
  CHECK (language IN ('en', 'fr'));

CREATE INDEX IF NOT EXISTS idx_questions_language
  ON questions (language, status, created_at DESC);
