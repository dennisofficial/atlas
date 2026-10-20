/*
  Warnings:

  - You are about to drop the column `sealedGpgKey` on the `CloudSandbox` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CloudSandbox" DROP COLUMN "sealedGpgKey";
