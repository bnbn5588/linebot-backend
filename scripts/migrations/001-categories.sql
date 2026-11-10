-- 001: transaction categories
-- Adds a nullable column (no existing row is rewritten; old records keep
-- CATEGORY = NULL and are shown as "other" until a category is set) and a
-- per-user table that remembers which category a note belongs to.
ALTER TABLE expense ADD (category VARCHAR2(30));

CREATE TABLE category_memory (
  uname       VARCHAR2(150) NOT NULL,
  note_key    VARCHAR2(250) NOT NULL,
  category    VARCHAR2(30)  NOT NULL,
  updated_at  DATE          DEFAULT SYSDATE NOT NULL,
  CONSTRAINT category_memory_pk PRIMARY KEY (uname, note_key)
)
