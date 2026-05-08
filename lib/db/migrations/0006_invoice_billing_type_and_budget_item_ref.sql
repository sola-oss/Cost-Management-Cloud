ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "billing_type" text NOT NULL DEFAULT 'full';
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "budget_item_id" integer REFERENCES "budget_items"("id") ON DELETE SET NULL;
