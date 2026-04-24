-- AlterTable
-- All existing users default to active. `is_active = false` disables login and
-- hides the user from scheduling/rosters without deleting any of their records
-- (shifts, time entries, audit history all stay intact so reactivation is
-- lossless).
ALTER TABLE "users" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Partial index: most queries only want active users, and inactive is the
-- minority case. Keeps scheduling/roster queries fast without adding overhead
-- for the rare "show deactivated" view.
CREATE INDEX "users_organization_id_is_active_idx" ON "users"("organization_id", "is_active");
