-- CreateTable
CREATE TABLE "UserContextSync" (
    "userId" TEXT NOT NULL,
    "memoryBundle" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserContextSync_pkey" PRIMARY KEY ("userId")
);
