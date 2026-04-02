/**
 * Seed script for work_types initial data.
 * Run with: pnpm --filter @workspace/db seed
 *       or: node lib/db/seed.mjs  (from workspace root)
 *
 * Idempotent: skips rows where code OR name already exists.
 */
import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const INITIAL_WORK_TYPES = [
  { code: '0610', name: '仮設工事',         construction_type: '建築' },
  { code: '0620', name: '土工事',           construction_type: '土木' },
  { code: '0630', name: '地業工事',         construction_type: '建築' },
  { code: '0640', name: '鉄筋工事',         construction_type: '建築' },
  { code: '0650', name: '型枠工事',         construction_type: '建築' },
  { code: '0660', name: 'コンクリート工事',  construction_type: '建築' },
  { code: '0670', name: '鉄骨工事',         construction_type: '建築' },
  { code: '0680', name: '木工事',           construction_type: '建築' },
  { code: '0690', name: '屋根工事',         construction_type: '建築' },
  { code: '0700', name: '外装工事',         construction_type: '建築' },
  { code: '0710', name: '内装工事',         construction_type: '建築' },
  { code: '0720', name: '塗装工事',         construction_type: '建築' },
  { code: '0730', name: '防水工事',         construction_type: '建築' },
  { code: '0740', name: '断熱工事',         construction_type: '建築' },
  { code: '0750', name: '建具工事',         construction_type: '建築' },
  { code: '0760', name: '電気設備工事',     construction_type: '設備' },
  { code: '0770', name: '給排水設備工事',   construction_type: '設備' },
  { code: '0780', name: '空調設備工事',     construction_type: '設備' },
  { code: '0790', name: '外構工事',         construction_type: '建築' },
  { code: '0800', name: '解体工事',         construction_type: '土木' },
  { code: '0810', name: 'その他',           construction_type: 'その他' },
];

async function seed() {
  let inserted = 0;
  let skipped = 0;

  for (const wt of INITIAL_WORK_TYPES) {
    const result = await pool.query(
      `INSERT INTO work_types (code, name, construction_type)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM work_types WHERE code = $1 OR name = $2
       )`,
      [wt.code, wt.name, wt.construction_type]
    );
    if (result.rowCount > 0) inserted++;
    else skipped++;
  }

  console.log(`Seed complete: ${inserted} inserted, ${skipped} skipped (already existed)`);
  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
