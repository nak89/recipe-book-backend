-- Ingredient.position — where a row sits in its recipe's list, zero-based.
--
-- Steps have always had `stepNumber` and every read sorts by it. Ingredients
-- had nothing: `include: { ingredients: true }` returned them in whatever order
-- Postgres chose, which happened to match insertion order only because `PUT`
-- deletes and recreates the whole list. That is now a stored fact, so the app
-- can reorder them.

-- Added with a default so the NOT NULL can be applied to existing rows in one
-- pass; the default is dropped at the end, which is what makes Prisma's
-- generated types require an explicit position at every create site.
ALTER TABLE "Ingredient" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill in `ctid` order — the physical row order, which is precisely the
-- accident that produced the order users are looking at today. Ordering by
-- anything else (name, id) would silently reshuffle every existing recipe on
-- the next read.
UPDATE "Ingredient" AS i
SET "position" = ordered.rn - 1
FROM (
  SELECT id, row_number() OVER (PARTITION BY "recipeId" ORDER BY ctid) AS rn
  FROM "Ingredient"
) AS ordered
WHERE i.id = ordered.id;

ALTER TABLE "Ingredient" ALTER COLUMN "position" DROP DEFAULT;
