/*
  Warnings:

  - You are about to drop the column `workspaceContext` on the `CloudSandbox` table. All the data in the column will be lost.
  - You are about to drop the column `workspaceContextArchive` on the `CloudSandbox` table. All the data in the column will be lost.
  - You are about to drop the column `workspaceSkills` on the `CloudSandbox` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CloudSandbox" DROP COLUMN "workspaceContext",
DROP COLUMN "workspaceContextArchive",
DROP COLUMN "workspaceSkills";
