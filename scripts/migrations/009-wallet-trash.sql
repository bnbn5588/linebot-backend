-- 009: wallets can be moved to the trash and restored within 30 days.
-- deleted_at NULL = normal wallet (every existing row). A trashed wallet keeps
-- its records and budgets; a daily job deletes it for good after 30 days.
-- Rollback: ALTER TABLE wallet DROP (deleted_at)
ALTER TABLE wallet ADD (deleted_at DATE)
