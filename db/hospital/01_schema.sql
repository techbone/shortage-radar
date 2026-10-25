-- Northwind General (fictional) pharmacy data. Synthetic; no patient data.

CREATE TABLE IF NOT EXISTS formulary_item (
  ndc            text PRIMARY KEY,          -- package NDC, 5-4-2 or similar with dashes
  generic_name   text NOT NULL,
  form           text NOT NULL,             -- injection | tablet | capsule | solution
  presentation   text NOT NULL,
  labeler        text NOT NULL,
  category       text NOT NULL,
  critical       boolean NOT NULL DEFAULT false,
  ndc_source     text NOT NULL              -- where the NDC came from: fda-shortage-list | ndc-directory
);

CREATE TABLE IF NOT EXISTS inventory (
  ndc                text PRIMARY KEY REFERENCES formulary_item(ndc),
  on_hand_units      integer NOT NULL,
  daily_usage_units  integer NOT NULL,
  reorder_point      integer NOT NULL,
  wholesaler         text NOT NULL
);

-- Read-only role for Zetaris: it may read, never write.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zetaris_reader') THEN
    CREATE ROLE zetaris_reader LOGIN PASSWORD 'reader';
  END IF;
END $$;
GRANT SELECT ON formulary_item, inventory TO zetaris_reader;
