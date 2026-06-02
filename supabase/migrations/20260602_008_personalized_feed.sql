-- Migration 008: personalized feed algorithm
-- Date: 2026-06-02
--
-- Creates get_personalized_feed() — a priority-tiered, cursor-paginated
-- PostgreSQL function that replaces the in-process TypeScript hot-sort
-- with a SQL-native approach.
--
-- Priority tiers (lower = shown first):
--   1  user's language  + NOT yet engaged
--   2  user's language  + already voted / has take
--   3  other language   + NOT yet engaged
--   4  other language   + already voted / has take
--
-- Within each tier the sort order follows p_sort:
--   'recent'  → created_at DESC
--   'hot'     → trending_score DESC  (mirrors the old TypeScript formula)
--
-- The compound cursor encodes (tier, sort_value, id) plus the session
-- anchor timestamp (p_fetched_at) so pagination never page-shifts on
-- new inserts during a browsing session.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Performance indexes ───────────────────────────────────────────────────

-- Feed base scan: active questions ordered by creation time
CREATE INDEX IF NOT EXISTS idx_questions_feed_lang
  ON questions (status, language, created_at DESC)
  WHERE status = 'active';

-- Votes lookup for per-user engagement check
CREATE INDEX IF NOT EXISTS idx_votes_user_question
  ON votes (user_id, question_id);

-- ── 2. get_personalized_feed() ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_personalized_feed(
  p_user_id       UUID,
  p_user_language TEXT        DEFAULT 'en',
  p_sort          TEXT        DEFAULT 'recent',
  p_limit         INT         DEFAULT 20,
  p_cursor_tier   INT         DEFAULT NULL,
  p_cursor_sort   TEXT        DEFAULT NULL,
  p_cursor_id     UUID        DEFAULT NULL,
  p_fetched_at    TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  id               UUID,
  text             TEXT,
  context          TEXT,
  category         TEXT,
  language         TEXT,
  status           TEXT,
  yes_count        INT,
  no_count         INT,
  total_votes      INT,
  yes_percent      INT,
  takes_count      INT,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ,
  user_voted       TEXT,
  user_has_engaged BOOLEAN,
  is_own           BOOLEAN,
  priority_tier    INT,
  trending_score   NUMERIC,
  is_trending      BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN

  -- ── HOT sort branch ─────────────────────────────────────────────────────
  IF p_sort = 'hot' THEN

    RETURN QUERY
    WITH
      user_votes AS (
        SELECT v.question_id, v.vote::TEXT
        FROM   votes v
        WHERE  v.user_id = p_user_id
      ),
      scored AS (
        SELECT
          q.id,
          q.text,
          q.context,
          q.category::TEXT,
          q.language::TEXT,
          q.status::TEXT,
          q.yes_count,
          q.no_count,
          (q.yes_count + q.no_count)                                         AS total_votes,
          CASE WHEN (q.yes_count + q.no_count) > 0
               THEN ROUND(q.yes_count * 100.0 / (q.yes_count + q.no_count))::INT
               ELSE 0 END                                                    AS yes_percent,
          COALESCE(q.takes_count, 0)                                         AS takes_count,
          q.expires_at,
          q.created_at,
          uv.vote                                                            AS user_voted,
          (uv.question_id IS NOT NULL)                                       AS user_has_engaged,
          (q.user_id = p_user_id)                                            AS is_own,
          CASE
            WHEN q.language = p_user_language AND uv.question_id IS NULL     THEN 1
            WHEN q.language = p_user_language AND uv.question_id IS NOT NULL THEN 2
            WHEN q.language != p_user_language AND uv.question_id IS NULL    THEN 3
            ELSE                                                                  4
          END                                                                AS priority_tier,
          -- Trending score: votes / age_hours^1.5 × freshness_boost
          -- Mirrors the TypeScript algorithm: baseScore × freshnessMultiplier
          CASE
            WHEN EXTRACT(EPOCH FROM (NOW() - q.created_at)) > 0
            THEN (
              (q.yes_count + q.no_count)::NUMERIC
              / POWER(
                  GREATEST(EXTRACT(EPOCH FROM (NOW() - q.created_at)) / 3600.0, 0.1),
                  1.5
                )
              * CASE
                  WHEN EXTRACT(EPOCH FROM (NOW() - q.created_at)) / 60.0 < 90.0
                  THEN 3.0 - (2.0 * (EXTRACT(EPOCH FROM (NOW() - q.created_at)) / 60.0) / 90.0)
                  ELSE 1.0
                END
            )
            ELSE 0.0
          END                                                                AS trending_score
        FROM  questions q
        LEFT JOIN user_votes uv ON uv.question_id = q.id
        WHERE q.status = 'active'
          AND q.created_at <= p_fetched_at
      ),
      filtered AS (
        SELECT s.*
        FROM   scored s
        WHERE
          -- No cursor: return everything (first page)
          p_cursor_tier IS NULL
          -- Strictly lower tier
          OR s.priority_tier > p_cursor_tier
          -- Same tier, lower score
          OR (
               s.priority_tier = p_cursor_tier
               AND s.trending_score < p_cursor_sort::NUMERIC
          )
          -- Same tier, same score: UUID tiebreaker (ORDER BY id DESC)
          OR (
               s.priority_tier = p_cursor_tier
               AND s.trending_score = p_cursor_sort::NUMERIC
               AND s.id < p_cursor_id
          )
      )
    SELECT
      f.id, f.text, f.context, f.category, f.language, f.status,
      f.yes_count, f.no_count, f.total_votes, f.yes_percent, f.takes_count,
      f.expires_at, f.created_at,
      f.user_voted, f.user_has_engaged, f.is_own,
      f.priority_tier, f.trending_score,
      FALSE::BOOLEAN AS is_trending
    FROM filtered f
    ORDER BY
      f.priority_tier  ASC,
      f.trending_score DESC NULLS LAST,
      f.id             DESC
    LIMIT p_limit + 1;   -- caller detects hasMore = returned_rows > p_limit

  -- ── RECENT sort branch ────────────────────────────────────────────────────
  ELSE

    RETURN QUERY
    WITH
      user_votes AS (
        SELECT v.question_id, v.vote::TEXT
        FROM   votes v
        WHERE  v.user_id = p_user_id
      ),
      scored AS (
        SELECT
          q.id,
          q.text,
          q.context,
          q.category::TEXT,
          q.language::TEXT,
          q.status::TEXT,
          q.yes_count,
          q.no_count,
          (q.yes_count + q.no_count)                                         AS total_votes,
          CASE WHEN (q.yes_count + q.no_count) > 0
               THEN ROUND(q.yes_count * 100.0 / (q.yes_count + q.no_count))::INT
               ELSE 0 END                                                    AS yes_percent,
          COALESCE(q.takes_count, 0)                                         AS takes_count,
          q.expires_at,
          q.created_at,
          uv.vote                                                            AS user_voted,
          (uv.question_id IS NOT NULL)                                       AS user_has_engaged,
          (q.user_id = p_user_id)                                            AS is_own,
          CASE
            WHEN q.language = p_user_language AND uv.question_id IS NULL     THEN 1
            WHEN q.language = p_user_language AND uv.question_id IS NOT NULL THEN 2
            WHEN q.language != p_user_language AND uv.question_id IS NULL    THEN 3
            ELSE                                                                  4
          END                                                                AS priority_tier,
          -- Trending score still computed (returned in payload; not used for ordering)
          CASE
            WHEN EXTRACT(EPOCH FROM (NOW() - q.created_at)) > 0
            THEN (
              (q.yes_count + q.no_count)::NUMERIC
              / POWER(
                  GREATEST(EXTRACT(EPOCH FROM (NOW() - q.created_at)) / 3600.0, 0.1),
                  1.5
                )
              * CASE
                  WHEN EXTRACT(EPOCH FROM (NOW() - q.created_at)) / 60.0 < 90.0
                  THEN 3.0 - (2.0 * (EXTRACT(EPOCH FROM (NOW() - q.created_at)) / 60.0) / 90.0)
                  ELSE 1.0
                END
            )
            ELSE 0.0
          END                                                                AS trending_score
        FROM  questions q
        LEFT JOIN user_votes uv ON uv.question_id = q.id
        WHERE q.status = 'active'
          AND q.created_at <= p_fetched_at
      ),
      filtered AS (
        SELECT s.*
        FROM   scored s
        WHERE
          -- No cursor: return everything (first page)
          p_cursor_tier IS NULL
          -- Strictly lower tier
          OR s.priority_tier > p_cursor_tier
          -- Same tier, older timestamp
          OR (
               s.priority_tier = p_cursor_tier
               AND s.created_at < p_cursor_sort::TIMESTAMPTZ
          )
          -- Same tier, same timestamp: UUID tiebreaker (ORDER BY id DESC)
          OR (
               s.priority_tier = p_cursor_tier
               AND s.created_at = p_cursor_sort::TIMESTAMPTZ
               AND s.id < p_cursor_id
          )
      )
    SELECT
      f.id, f.text, f.context, f.category, f.language, f.status,
      f.yes_count, f.no_count, f.total_votes, f.yes_percent, f.takes_count,
      f.expires_at, f.created_at,
      f.user_voted, f.user_has_engaged, f.is_own,
      f.priority_tier, f.trending_score,
      FALSE::BOOLEAN AS is_trending
    FROM filtered f
    ORDER BY
      f.priority_tier ASC,
      f.created_at    DESC NULLS LAST,
      f.id            DESC
    LIMIT p_limit + 1;   -- caller detects hasMore = returned_rows > p_limit

  END IF;

END;
$$;

-- ── 3. Permissions ───────────────────────────────────────────────────────────
-- Grant execute to all Supabase roles so the function can be called via RPC
-- regardless of which client key is used (service_role bypasses RLS anyway).
GRANT EXECUTE
  ON FUNCTION get_personalized_feed(UUID, TEXT, TEXT, INT, INT, TEXT, UUID, TIMESTAMPTZ)
  TO authenticated, anon, service_role;
