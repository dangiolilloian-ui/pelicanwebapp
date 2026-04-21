-- Add optional location and position targeting to announcements
ALTER TABLE "announcements" ADD COLUMN "location_id" TEXT;
ALTER TABLE "announcements" ADD COLUMN "position_id" TEXT;
CREATE INDEX "announcements_location_id_idx" ON "announcements"("location_id");
CREATE INDEX "announcements_position_id_idx" ON "announcements"("position_id");
