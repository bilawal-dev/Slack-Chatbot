/*
  Warnings:

  - You are about to drop the column `locationId` on the `Thread` table. All the data in the column will be lost.
  - Added the required column `listId` to the `Thread` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Thread" DROP COLUMN "locationId",
ADD COLUMN     "listId" TEXT NOT NULL;
