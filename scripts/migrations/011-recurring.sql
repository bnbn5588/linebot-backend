-- 011: recurring records (components/recurring.js). A new table plus one
-- nullable column on EXPENSE; no existing row is changed.
--   RECURRING: one row per recurring item of a wallet. Every day at 07:00 Thai
--   time the cron records the items that are due (once per month each).
--     day_of_month  1..31; a month without that day uses its last day
--     notify        1 = tell the user in LINE when it is recorded, 0 = silent
--     paused        1 = not recorded until resumed
--     start_month   YYYY-MM, first month it may be recorded
--     last_month    YYYY-MM, last month it was recorded (never twice a month)
--   EXPENSE.recurring_id: the RECURRING item that recorded the row (NULL for
--   every record typed by the user, including all existing rows).
-- Rollback: DROP TABLE recurring; ALTER TABLE expense DROP (recurring_id)
CREATE TABLE recurring (
  rec_id        NUMBER        NOT NULL,  -- MAX + 1 by the app (no CREATE SEQUENCE on prod)
  uname         VARCHAR2(150) NOT NULL,
  wallet_id     NUMBER        NOT NULL,
  exvalue       NUMBER(12,2)  NOT NULL,
  note          VARCHAR2(250) NOT NULL,
  category      VARCHAR2(30),
  day_of_month  NUMBER(2)     NOT NULL,
  notify        NUMBER(1)     DEFAULT 1 NOT NULL,
  paused        NUMBER(1)     DEFAULT 0 NOT NULL,
  start_month   VARCHAR2(7)   NOT NULL,
  last_month    VARCHAR2(7),
  created_at    DATE          DEFAULT SYSDATE NOT NULL,
  updated_at    DATE          DEFAULT SYSDATE NOT NULL,
  CONSTRAINT recurring_pk PRIMARY KEY (rec_id),
  CONSTRAINT recurring_day_ck CHECK (day_of_month BETWEEN 1 AND 31),
  CONSTRAINT recurring_flags_ck CHECK (notify IN (0, 1) AND paused IN (0, 1))
);
CREATE INDEX recurring_user_ix ON recurring (uname, wallet_id);
ALTER TABLE expense ADD (recurring_id NUMBER)
