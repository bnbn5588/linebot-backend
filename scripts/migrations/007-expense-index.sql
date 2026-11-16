-- 007: index for per-user, per-wallet date-range queries on EXPENSE
-- (summaries, budgets, monthly card, record replies). Adds no data and changes
-- no rows. ONLINE keeps the table writable while it builds.
-- Rollback: DROP INDEX expense_uw_date_ix;
CREATE INDEX expense_uw_date_ix ON expense (uname, wallet_id, fulldate) ONLINE;
