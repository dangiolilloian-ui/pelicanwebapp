-- Tier 1 features: geofencing, kiosk PIN, weekly hours cap, ical, shift confirmation, open shifts (claims)

-- User additions
ALTER TABLE "users" ADD COLUMN "pin" TEXT;
ALTER TABLE "users" ADD COLUMN "weekly_hours_cap" INTEGER;
ALTER TABLE "users" ADD COLUMN "ical_token" TEXT;
CREATE UNIQUE INDEX "users_ical_token_key" ON "users"("ical_token");
CREATE UNIQUE INDEX "users_organization_id_pin_key" ON "users"("organization_id", "pin");

-- Location additions (geofencing)
ALTER TABLE "locations" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN "radius_meters" INTEGER NOT NULL DEFAULT 150;

-- Shift confirmation
ALTER TABLE "shifts" ADD COLUMN "confirmed_at" TIMESTAMP(3);

-- ShiftClaim (open shifts marketplace)
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');

CREATE TABLE "shift_claims" (
    "id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_claims_shift_id_user_id_key" ON "shift_claims"("shift_id", "user_id");

ALTER TABLE "shift_claims" ADD CONSTRAINT "shift_claims_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_claims" ADD CONSTRAINT "shift_claims_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
