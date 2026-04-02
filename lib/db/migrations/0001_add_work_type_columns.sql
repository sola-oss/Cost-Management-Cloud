-- Migration: Add construction_type and notes columns to work_types
-- Applied via: drizzle-kit push --force (schema-based push workflow)
-- To replay manually against a blank DB:
--   psql $DATABASE_URL -f lib/db/migrations/0001_add_work_type_columns.sql

ALTER TABLE work_types
  ADD COLUMN IF NOT EXISTS construction_type text NOT NULL DEFAULT 'その他',
  ADD COLUMN IF NOT EXISTS notes text;
