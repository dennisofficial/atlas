-- CreateTable
CREATE TABLE "PublishedBundle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "pathname" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishedBundle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublishedBundle_userId_version_key" ON "PublishedBundle"("userId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedBundle_pathname_key" ON "PublishedBundle"("pathname");

-- AddForeignKey
ALTER TABLE "PublishedBundle" ADD CONSTRAINT "PublishedBundle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
