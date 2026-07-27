-- Rename rather than drop/add so any existing values survive.
ALTER TABLE "Recipe" RENAME COLUMN "course" TO "mealtime";
