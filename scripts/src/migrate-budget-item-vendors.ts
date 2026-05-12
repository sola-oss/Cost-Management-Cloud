import { db, budgetItemsTable, vendorsTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";

async function main() {
  console.log("🔍 supplier_name と vendors.name を照合して vendor_id を設定します...\n");

  const items = await db
    .select()
    .from(budgetItemsTable)
    .where(
      and(
        isNull(budgetItemsTable.vendorId),
      )
    );

  const vendors = await db.select().from(vendorsTable);

  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    const name = item.supplierName?.trim();
    if (!name) {
      skipped++;
      continue;
    }
    const match = vendors.find(
      v => v.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (!match) {
      console.log(`  ⚠️  一致なし: budget_item id=${item.id} supplierName="${name}"`);
      skipped++;
      continue;
    }
    await db
      .update(budgetItemsTable)
      .set({ vendorId: match.id, updatedAt: new Date() })
      .where(eq(budgetItemsTable.id, item.id));
    console.log(`  ✅  id=${item.id} "${name}" → vendor_id=${match.id}`);
    updated++;
  }

  console.log(`\n完了: 更新=${updated} 件、スキップ=${skipped} 件`);
  process.exit(0);
}

main().catch(err => {
  console.error("エラー:", err);
  process.exit(1);
});
