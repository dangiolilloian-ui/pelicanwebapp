-- Weekly labor budget cap per location (nullable = no budget set)
ALTER TABLE locations ADD COLUMN weekly_budget DOUBLE PRECISION;

-- Dedup marker for scheduled shift-start reminders
ALTER TABLE shifts ADD COLUMN reminder_sent_at TIMESTAMP(3);
