-- Migration: Add company_settings, invoices, invoice_items, invoice_payments tables
-- Applied via: drizzle-kit push (schema-based push workflow)
-- To replay manually against a blank DB:
--   psql $DATABASE_URL -f lib/db/migrations/0003_add_company_settings_and_invoices.sql

CREATE TABLE IF NOT EXISTS "company_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_name" text NOT NULL DEFAULT '',
  "postal_code" text DEFAULT '',
  "address" text DEFAULT '',
  "tel" text DEFAULT '',
  "fax" text DEFAULT '',
  "invoice_registration_number" text DEFAULT '',
  "representative_name" text DEFAULT '',
  "department" text DEFAULT '',
  "bank_name" text DEFAULT '',
  "bank_branch" text DEFAULT '',
  "bank_account_type" text DEFAULT '普通',
  "bank_account_number" text DEFAULT '',
  "bank_account_name" text DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" serial PRIMARY KEY NOT NULL,
  "invoice_number" text NOT NULL UNIQUE,
  "invoice_date" date NOT NULL,
  "due_date" date,
  "client_id" integer REFERENCES "clients"("id") ON DELETE SET NULL,
  "client_name" text NOT NULL DEFAULT '',
  "client_address" text DEFAULT '',
  "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL,
  "project_name" text DEFAULT '',
  "invoice_registration_number" text DEFAULT '',
  "tax_excluded_amount_10" numeric(15, 2) NOT NULL DEFAULT 0,
  "tax_amount_10" numeric(15, 2) NOT NULL DEFAULT 0,
  "tax_excluded_amount_8" numeric(15, 2) NOT NULL DEFAULT 0,
  "tax_amount_8" numeric(15, 2) NOT NULL DEFAULT 0,
  "tax_excluded_total" numeric(15, 2) NOT NULL DEFAULT 0,
  "tax_total" numeric(15, 2) NOT NULL DEFAULT 0,
  "total_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "paid_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'unpaid',
  "notes" text DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "invoice_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "invoice_id" integer NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "row_index" integer NOT NULL DEFAULT 0,
  "item_name" text NOT NULL DEFAULT '',
  "quantity" numeric(15, 3) NOT NULL DEFAULT 1,
  "unit" text DEFAULT '',
  "unit_price" numeric(15, 2) NOT NULL DEFAULT 0,
  "tax_rate" numeric(5, 2) NOT NULL DEFAULT 10,
  "amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "invoice_payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "invoice_id" integer NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "payment_date" date NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "payment_method" text NOT NULL DEFAULT '振込',
  "notes" text DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
