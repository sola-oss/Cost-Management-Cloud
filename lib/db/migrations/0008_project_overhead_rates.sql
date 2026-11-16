-- 2026-11-16 工事原価計算書の消耗品費・諸経費の率（工事ごと、単位は%）。空なら消耗品費3%・諸経費10%で計算する
ALTER TABLE projects ADD COLUMN IF NOT EXISTS consumable_rate numeric(5,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS overhead_rate numeric(5,2);
