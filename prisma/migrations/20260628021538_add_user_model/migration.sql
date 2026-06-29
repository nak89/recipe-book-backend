-- Create the User table
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Insert one real user to own your existing recipes
INSERT INTO "User" ("id", "email", "password", "createdAt")
VALUES ('11111111-1111-1111-1111-111111111111', 'test@gmail.com', 'placeholder_will_be_replaced', CURRENT_TIMESTAMP);

-- Add userId as nullable first, so existing rows don't break
ALTER TABLE "Recipe" ADD COLUMN "userId" TEXT;

-- Assign all existing recipes to that user
UPDATE "Recipe" SET "userId" = '11111111-1111-1111-1111-111111111111';

-- Now make it required, since every row has a value
ALTER TABLE "Recipe" ALTER COLUMN "userId" SET NOT NULL;

-- Add the foreign key relationship
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;