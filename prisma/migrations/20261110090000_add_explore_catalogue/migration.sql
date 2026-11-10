BEGIN;
CREATE TABLE public."ExploreCatalogue" (
  "id" TEXT PRIMARY KEY,
  "recipes" JSONB NOT NULL,
  "schedule" JSONB NOT NULL
);
ALTER TABLE public."ExploreCatalogue" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."ExploreCatalogue" FROM PUBLIC, anon, authenticated;
COMMIT;
