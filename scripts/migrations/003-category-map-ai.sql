-- 003: AI suggestions in the shared category table. Adds how sure the AI was
-- (0-1) and which model answered. Both stay NULL for admin / history rows.
-- Existing rows are not changed.
ALTER TABLE category_map ADD (
  confidence  NUMBER(4,3),
  model       VARCHAR2(60)
)
