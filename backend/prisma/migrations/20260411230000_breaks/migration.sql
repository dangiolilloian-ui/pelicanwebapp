ALTER TABLE time_entries ADD COLUMN break_started_at TIMESTAMP(3);
ALTER TABLE time_entries ADD COLUMN total_break_minutes INTEGER NOT NULL DEFAULT 0;
