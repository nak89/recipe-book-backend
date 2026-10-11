-- Recipes are served exclusively by Express through the database owner.
-- Supabase client roles must never access these tables directly. Keep this in
-- migration history rather than relying on dashboard settings/event triggers.
BEGIN;
ALTER TABLE public."Recipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Ingredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Step" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MealPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."GroceryLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."GroceryItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public."Recipe", public."Ingredient", public."Step", public."MealPlan",
  public."GroceryLine", public."GroceryItem", public."_prisma_migrations"
FROM PUBLIC, anon, authenticated;

-- Prisma migrations use postgres. Newly created tables/sequences must not
-- silently grant client access. Each future table still needs explicit RLS.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
COMMIT;
