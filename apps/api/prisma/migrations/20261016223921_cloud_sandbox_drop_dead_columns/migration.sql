/*
  Warnings:

  - You are about to drop the column `driveMode` on the `CloudSandbox` table. All the data in the column will be lost.
  - You are about to drop the column `transcriptArchive` on the `CloudSandbox` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CloudSandbox" DROP COLUMN "driveMode",
DROP COLUMN "transcriptArchive";
