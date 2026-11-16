-- 006: monthly budget per category (components/budget.js). A new table;
-- no existing row is changed. One row per user, wallet and expense
-- category; the amount applies to every month until changed or removed.
CREATE TABLE budget (
  uname       VARCHAR2(150) NOT NULL,
  wallet_id   NUMBER        NOT NULL,
  category    VARCHAR2(30)  NOT NULL,
  amount      NUMBER(12,2)  NOT NULL,
  updated_at  DATE          DEFAULT SYSDATE NOT NULL,
  CONSTRAINT budget_pk PRIMARY KEY (uname, wallet_id, category)
)
