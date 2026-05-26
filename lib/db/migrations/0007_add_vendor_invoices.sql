CREATE TABLE IF NOT EXISTS "vendor_invoices" (
  "id" serial PRIMARY KEY NOT NULL,
  "vendor_id" integer NOT NULL REFERENCES "vendors"("id") ON DELETE CASCADE,
  "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL,
  "invoice_number" text,
  "invoice_date" date NOT NULL,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "tax_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "total_amount" numeric(15, 2) NOT NULL,
  "notes" text,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
