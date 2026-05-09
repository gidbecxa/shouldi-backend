-- PLG (Product-Led Growth) schema additions

-- 1. Alter users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS timezone_offset INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_prompted BOOLEAN DEFAULT FALSE;
-- timezone_offset: UTC offset in minutes, e.g. +60 for UTC+1, -300 for UTC-5

-- 2. Alter questions table
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;

-- 3. Allow nullable question_id in notification_log (needed for re_engage type)
ALTER TABLE notification_log ALTER COLUMN question_id DROP NOT NULL;

-- 4. Create shares table
CREATE TABLE IF NOT EXISTS shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  share_type TEXT NOT NULL CHECK (share_type IN ('image', 'link', 'copy')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shares_question ON shares(question_id);
CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);

-- 5. Create qotd (Question of the Day) table
CREATE TABLE IF NOT EXISTS qotd (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  date DATE UNIQUE NOT NULL DEFAULT CURRENT_DATE,
  is_manual BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_qotd_date ON qotd(date);

-- 6. Create scheduled_notifications table
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_notif_send_at ON scheduled_notifications(send_at) WHERE sent = FALSE;

-- 7. Create live_stats materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS live_stats AS
SELECT
  (SELECT COUNT(DISTINCT user_id) FROM votes WHERE created_at > NOW() - INTERVAL '1 hour') AS active_voters_last_hour,
  (SELECT COUNT(*) FROM votes WHERE created_at >= CURRENT_DATE) AS votes_today,
  (SELECT COUNT(*) FROM questions WHERE created_at >= CURRENT_DATE) AS questions_today;

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_stats ON live_stats((1));

-- 8. SQL helper functions

CREATE OR REPLACE FUNCTION increment_share_count(p_question_id UUID)
RETURNS void AS $$
  UPDATE questions SET share_count = share_count + 1 WHERE id = p_question_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION refresh_live_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW live_stats;
END;
$$ LANGUAGE plpgsql;

-- 9. RLS policies (all tables are accessed exclusively via service-role backend)
ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE qotd ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_notifications ENABLE ROW LEVEL SECURITY;
-- No client-level policies — backend uses service role which bypasses RLS
