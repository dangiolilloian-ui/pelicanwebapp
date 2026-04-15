-- The breakReminderAt field was added to the Prisma schema in an earlier
-- session but the accompanying migration was never committed, leaving the
-- DB without the column. This catches the schema back up.
ALTER TABLE "time_entries" ADD COLUMN "break_reminder_at" TIMESTAMP(3);
