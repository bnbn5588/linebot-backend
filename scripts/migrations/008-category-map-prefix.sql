-- 008: "starts with" rows in the shared category table. match_mode 'exact'
-- (default, every existing row) = the whole note must match; 'prefix' = the
-- note starts with note_key (Latin: at a word boundary), longest prefix wins,
-- exact rows always win over prefix rows. Existing rows are not changed.
-- Rollback: ALTER TABLE category_map DROP (match_mode)
ALTER TABLE category_map ADD (
  match_mode  VARCHAR2(6) DEFAULT 'exact' NOT NULL
              CONSTRAINT category_map_match_ck CHECK (match_mode IN ('exact', 'prefix'))
)
