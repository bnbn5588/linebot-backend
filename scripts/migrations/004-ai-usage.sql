-- 004: Gemini usage per day, for the admin site. One row per
-- (day, origin, outcome), counters only — no notes, no user ids.
--   origin:  auto  = background fill after /api/add
--            admin = "ถาม AI" on the admin site
--   outcome: ok, or the error code (QUOTA, BUSY, NETWORK, HTTP, BAD_RESPONSE)
--   calls    = questions asked; attempts = HTTP requests sent to Gemini
--              (retries included — this is what Google's per-day limit counts)
-- day is TRUNC(SYSDATE) of the DB (UTC).
CREATE TABLE ai_usage (
  day       DATE          NOT NULL,
  origin    VARCHAR2(10)  NOT NULL,
  outcome   VARCHAR2(20)  NOT NULL,
  calls     NUMBER        DEFAULT 0 NOT NULL,
  attempts  NUMBER        DEFAULT 0 NOT NULL,
  ms_total  NUMBER        DEFAULT 0 NOT NULL,
  CONSTRAINT ai_usage_pk PRIMARY KEY (day, origin, outcome),
  CONSTRAINT ai_usage_origin_ck CHECK (origin IN ('auto', 'admin'))
)
