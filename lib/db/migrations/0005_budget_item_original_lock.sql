ALTER TABLE "budget_items" ADD COLUMN IF NOT EXISTS "is_original_locked" boolean NOT NULL DEFAULT false;
ALTER TABLE "budget_items" ADD COLUMN IF NOT EXISTS "original_budget_amount" numeric(15,2) NOT NULL DEFAULT 0;
