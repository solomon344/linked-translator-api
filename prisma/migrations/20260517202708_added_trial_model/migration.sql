-- CreateTable
CREATE TABLE "InstallTrial" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "freeUses" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "verificationCode" TEXT,
    "codeExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallTrial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstallTrial_installId_key" ON "InstallTrial"("installId");
