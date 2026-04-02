-- Migration: Add clients table and new project fields
-- Applied via: drizzle-kit push (schema-based push workflow)
-- To replay manually against a blank DB:
--   psql $DATABASE_URL -f lib/db/migrations/0002_add_clients_and_project_fields.sql

CREATE TABLE IF NOT EXISTS "clients" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_code" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "address" text,
  "tel" text,
  "contact_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "public_private_type" text,
  ADD COLUMN IF NOT EXISTS "client_code" text,
  ADD COLUMN IF NOT EXISTS "construction_history_type" text,
  ADD COLUMN IF NOT EXISTS "construction_history_engineer" text;
