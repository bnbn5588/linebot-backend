-- 005: monthly summary push (components/monthlySummary.js). Two nullable
-- columns on USERS; no existing row is changed.
--   summary_off   when the user typed "ปิดสรุปรายเดือน" (NULL = on)
--   summary_sent  the last month (YYYY-MM) whose summary was pushed, so a
--                 rerun never sends the same month twice
ALTER TABLE users ADD (
  summary_off   DATE,
  summary_sent  VARCHAR2(7)
)
