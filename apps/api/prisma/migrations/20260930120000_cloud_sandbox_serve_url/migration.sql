-- Rows that predate client-side registration keep NULL and fall back to the Vercel probe.

-- AlterTable
ALTER TABLE "CloudSandbox" ADD COLUMN "serveUrl" TEXT;
