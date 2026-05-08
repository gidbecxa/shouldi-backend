CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  push_token TEXT,
  is_banned BOOLEAN DEFAULT FALSE,
  ban_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) <= 120),
  category TEXT NOT NULL CHECK (category IN ('Life','Love','Career','Money','Health','Fun','Other')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','closed','flagged','deleted')),
  yes_count INTEGER DEFAULT 0,
  no_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('yes','no')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(question_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('harmful','inappropriate','spam','personal_attack')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(question_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS banned_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, question_id, type)
);

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_questions_status_created ON questions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_expires ON questions(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_votes_question ON votes(question_id);
CREATE INDEX IF NOT EXISTS idx_reports_question ON reports(question_id);
CREATE INDEX IF NOT EXISTS idx_banned_keywords_keyword ON banned_keywords(keyword);

CREATE OR REPLACE FUNCTION cast_vote(p_question_id UUID, p_user_id UUID, p_vote TEXT)
RETURNS TABLE (yes_count INTEGER, no_count INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_vote NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'invalid vote' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM questions
    WHERE id = p_question_id
      AND status = 'active'
      AND expires_at > NOW()
  ) THEN
    RAISE EXCEPTION 'question not active' USING ERRCODE = '22023';
  END IF;

  INSERT INTO votes (question_id, user_id, vote)
  VALUES (p_question_id, p_user_id, p_vote);

  IF p_vote = 'yes' THEN
    UPDATE questions
    SET yes_count = yes_count + 1
    WHERE id = p_question_id;
  ELSE
    UPDATE questions
    SET no_count = no_count + 1
    WHERE id = p_question_id;
  END IF;

  RETURN QUERY
  SELECT q.yes_count, q.no_count
  FROM questions q
  WHERE q.id = p_question_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already voted' USING ERRCODE = '23505';
END;
$$;

CREATE OR REPLACE FUNCTION report_question(p_question_id UUID, p_reporter_id UUID, p_reason TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  report_count INTEGER;
BEGIN
  INSERT INTO reports (question_id, reporter_id, reason)
  VALUES (p_question_id, p_reporter_id, p_reason)
  ON CONFLICT (question_id, reporter_id) DO NOTHING;

  SELECT COUNT(DISTINCT reporter_id)
  INTO report_count
  FROM reports
  WHERE question_id = p_question_id;

  IF report_count >= 3 THEN
    UPDATE questions
    SET status = 'flagged'
    WHERE id = p_question_id
      AND status = 'active';
  END IF;

  RETURN report_count;
END;
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE banned_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_self ON users;
DROP POLICY IF EXISTS users_update_self ON users;
DROP POLICY IF EXISTS users_insert_self ON users;
CREATE POLICY users_select_self ON users
FOR SELECT TO authenticated
USING (id = auth.uid());
CREATE POLICY users_update_self ON users
FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());
CREATE POLICY users_insert_self ON users
FOR INSERT TO authenticated
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS questions_select_public ON questions;
DROP POLICY IF EXISTS questions_insert_own ON questions;
DROP POLICY IF EXISTS questions_update_own ON questions;
CREATE POLICY questions_select_public ON questions
FOR SELECT TO anon, authenticated
USING (status <> 'deleted');
CREATE POLICY questions_insert_own ON questions
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY questions_update_own ON questions
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS votes_select_own ON votes;
DROP POLICY IF EXISTS votes_insert_own ON votes;
DROP POLICY IF EXISTS votes_delete_own ON votes;
CREATE POLICY votes_select_own ON votes
FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY votes_insert_own ON votes
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY votes_delete_own ON votes
FOR DELETE TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS reports_insert_non_banned ON reports;
CREATE POLICY reports_insert_non_banned ON reports
FOR INSERT TO authenticated
WITH CHECK (
  reporter_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = reporter_id
      AND u.is_banned = FALSE
  )
);

DROP POLICY IF EXISTS banned_keywords_read_admin ON banned_keywords;
CREATE POLICY banned_keywords_read_admin ON banned_keywords
FOR SELECT TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS notification_log_select_own ON notification_log;
CREATE POLICY notification_log_select_own ON notification_log
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS waitlist_insert_public ON waitlist;
CREATE POLICY waitlist_insert_public ON waitlist
FOR INSERT TO anon, authenticated
WITH CHECK (position('@' in email) > 1);

INSERT INTO banned_keywords (keyword, category)
SELECT keyword, 'self_harm'
FROM unnest(ARRAY[
  'kill myself','end it all','want to die','hurt myself','cut myself','suicide','self harm','take my life','ending my life','not worth living',
  'no reason to live','die tonight','unalive myself','overdose myself','jump off bridge','hang myself','shoot myself','poison myself','bleed out','cant go on',
  'life is pointless','i should disappear','self destruct','wish i were dead','how to die','ways to kill myself','end my suffering','goodbye forever','last day alive','no will to live'
]) AS keyword
ON CONFLICT (keyword) DO NOTHING;

INSERT INTO banned_keywords (keyword, category)
SELECT keyword, 'violence'
FROM unnest(ARRAY[
  'kill someone','hurt them','attack','stab','shoot','beat up','assault','threaten','burn them','poison them',
  'break their neck','punch them','smash their face','bring a weapon','school shooting','armed attack','bomb threat','blow up','run them over','violent revenge',
  'hit my partner','fight someone','knife attack','gun attack','make them bleed','strangle them','choke them','murder plan','kill my boss','kill my neighbor'
]) AS keyword
ON CONFLICT (keyword) DO NOTHING;

INSERT INTO banned_keywords (keyword, category)
SELECT keyword, 'sexual'
FROM unnest(ARRAY[
  'nude','nudes','naked pic','send nudes','sex tape','porn','xxx','onlyfans','hookup tonight','one night stand',
  'explicit photo','dick pic','boob pic','genital','oral sex','anal sex','fetish porn','sexting','nsfw content','camgirl',
  'escort service','adult content','erotic chat','sexual fantasy','rape fantasy','incest','child porn','underage sex','sex for money','sugar daddy'
]) AS keyword
ON CONFLICT (keyword) DO NOTHING;

INSERT INTO banned_keywords (keyword, category)
SELECT keyword, 'hate_speech'
FROM unnest(ARRAY[
  'hate immigrants','hate gays','hate muslims','hate christians','hate jews','hate black people','hate white people','ethnic cleansing','racial purity','white supremacy',
  'nazi','hitler was right','genocide them','kill that race','inferior race','deport them all','ban all muslims','anti semitic','homophobic rant','transphobic',
  'lynch them','race war','terrorist race','go back to your country','hate speech','spread hate','burn their mosque','burn their church','burn their synagogue','eliminate that group'
]) AS keyword
ON CONFLICT (keyword) DO NOTHING;
