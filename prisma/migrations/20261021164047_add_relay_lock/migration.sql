-- CreateTable
CREATE TABLE "relay_lock" (
    "name" VARCHAR(80) NOT NULL,
    "holder" VARCHAR(120) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "relay_lock_pkey" PRIMARY KEY ("name")
);
