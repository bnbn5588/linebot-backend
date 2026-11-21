-- 010: reminder to record + weekly summary settings on USERS. All NULL/0 for
-- existing users = both off (opt-in).
--   remind_on      DATE         when the user turned the 21:00 reminder on (NULL = off)
--   remind_last    VARCHAR2(10) last day reminded, YYYY-MM-DD in the wallet's time zone
--   remind_skip    VARCHAR2(10) day the user pressed "วันนี้ไม่ได้ใช้เงิน"
--   remind_streak  NUMBER(3)    reminders in a row without a record; 7 = paused until they record again
--   weekly_on      DATE         when the weekly summary was turned on (NULL = off)
--   weekly_sent    VARCHAR2(10) Monday (YYYY-MM-DD) of the last week sent
-- Rollback: ALTER TABLE users DROP (remind_on, remind_last, remind_skip, remind_streak, weekly_on, weekly_sent)
ALTER TABLE users ADD (
  remind_on      DATE,
  remind_last    VARCHAR2(10),
  remind_skip    VARCHAR2(10),
  remind_streak  NUMBER(3) DEFAULT 0 NOT NULL,
  weekly_on      DATE,
  weekly_sent    VARCHAR2(10)
)
