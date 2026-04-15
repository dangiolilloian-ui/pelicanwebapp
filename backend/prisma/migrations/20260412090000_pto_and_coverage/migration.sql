-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "pto_config" JSONB;

-- AlterTable
ALTER TABLE "time_off_requests" ADD COLUMN "hours" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "pto_ledger" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pto_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pto_ledger_organization_id_user_id_created_at_idx" ON "pto_ledger"("organization_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "pto_ledger_user_id_kind_idx" ON "pto_ledger"("user_id", "kind");

-- CreateTable
CREATE TABLE "coverage_requirements" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "location_id" TEXT,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "min_staff" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coverage_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coverage_requirements_organization_id_day_of_week_idx" ON "coverage_requirements"("organization_id", "day_of_week");
