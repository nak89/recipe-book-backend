CREATE TABLE public."RecipeDraftQuota" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL CHECK ("count" > 0),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL
);

ALTER TABLE public."RecipeDraftQuota" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."RecipeDraftQuota" FROM PUBLIC, anon, authenticated;

-- The deployment's login is provisioned separately, with a secret that never enters migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'recipe_book_runtime') THEN
    CREATE ROLE recipe_book_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO recipe_book_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."Recipe", public."Ingredient", public."Step", public."MealPlan",
  public."GroceryLine", public."GroceryItem" TO recipe_book_runtime;
GRANT SELECT ON TABLE public."ExploreCatalogue" TO recipe_book_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public."RecipeDraftQuota" TO recipe_book_runtime;

-- The API still checks the authenticated owner on every private data operation.
CREATE POLICY recipe_book_runtime_access ON public."Recipe" TO recipe_book_runtime USING (true) WITH CHECK (true);
CREATE POLICY recipe_book_runtime_access ON public."Ingredient" TO recipe_book_runtime USING (true) WITH CHECK (true);
CREATE POLICY recipe_book_runtime_access ON public."Step" TO recipe_book_runtime USING (true) WITH CHECK (true);
CREATE POLICY recipe_book_runtime_access ON public."MealPlan" TO recipe_book_runtime USING (true) WITH CHECK (true);
CREATE POLICY recipe_book_runtime_access ON public."GroceryLine" TO recipe_book_runtime USING (true) WITH CHECK (true);
CREATE POLICY recipe_book_runtime_access ON public."GroceryItem" TO recipe_book_runtime USING (true) WITH CHECK (true);
CREATE POLICY recipe_book_runtime_catalogue ON public."ExploreCatalogue" FOR SELECT TO recipe_book_runtime USING (true);
CREATE POLICY recipe_book_runtime_access ON public."RecipeDraftQuota" TO recipe_book_runtime USING (true) WITH CHECK (true);
