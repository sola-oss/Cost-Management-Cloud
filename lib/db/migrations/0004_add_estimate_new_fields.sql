ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "representative_name" text DEFAULT '';
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "construction_license" text DEFAULT '';
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "staff_mobile" text DEFAULT '';
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "staff_email" text DEFAULT '';
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "misc_expenses_rate" numeric(5,2) DEFAULT 0;
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(15,2) DEFAULT 0;
