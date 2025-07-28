/*
  Warnings:

  - A unique constraint covering the columns `[slackThreadTs]` on the table `Thread` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Thread_slackThreadTs_key" ON "Thread"("slackThreadTs");
