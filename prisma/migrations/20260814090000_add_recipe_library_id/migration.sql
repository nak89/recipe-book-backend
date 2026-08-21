-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "libraryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_userId_libraryId_key" ON "Recipe"("userId", "libraryId");

