ALTER TABLE public."Recipe" ADD COLUMN "sharedFromId" TEXT;
CREATE UNIQUE INDEX "Recipe_userId_sharedFromId_key" ON public."Recipe" ("userId", "sharedFromId");

CREATE TABLE public."RecipeShare" (
  "recipeId" TEXT PRIMARY KEY REFERENCES public."Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tokenHash" TEXT NOT NULL UNIQUE
);

ALTER TABLE public."RecipeShare" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."RecipeShare" FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."RecipeShare" TO recipe_book_runtime;
CREATE POLICY recipe_book_runtime_access ON public."RecipeShare" TO recipe_book_runtime USING (true) WITH CHECK (true);
