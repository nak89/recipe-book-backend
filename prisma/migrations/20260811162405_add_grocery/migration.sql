-- CreateTable
CREATE TABLE "GroceryLine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "key" TEXT NOT NULL,
    "ticked" BOOLEAN NOT NULL DEFAULT false,
    "amountOverride" DOUBLE PRECISION,

    CONSTRAINT "GroceryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroceryItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "ticked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroceryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroceryLine_userId_weekStart_idx" ON "GroceryLine"("userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "GroceryLine_userId_weekStart_key_key" ON "GroceryLine"("userId", "weekStart", "key");

-- CreateIndex
CREATE INDEX "GroceryItem_userId_weekStart_idx" ON "GroceryItem"("userId", "weekStart");

