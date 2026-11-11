-- 002: shared note → category mapping for ALL users (edited on the admin site,
-- seeded from existing records (source 'history') and later filled by AI
-- suggestions (source 'ai')). Used after the user's own memory and
-- before keyword guessing. New table only; no existing row is changed.
CREATE TABLE category_map (
  note_key    VARCHAR2(250) NOT NULL,
  kind        VARCHAR2(7)   NOT NULL,
  category    VARCHAR2(30)  NOT NULL,
  source      VARCHAR2(10)  DEFAULT 'admin' NOT NULL,
  updated_at  DATE          DEFAULT SYSDATE NOT NULL,
  updated_by  VARCHAR2(150),
  CONSTRAINT category_map_pk PRIMARY KEY (note_key, kind),
  CONSTRAINT category_map_kind_ck CHECK (kind IN ('expense', 'income')),
  CONSTRAINT category_map_source_ck CHECK (source IN ('admin', 'ai', 'history'))
)
