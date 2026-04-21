-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME';
