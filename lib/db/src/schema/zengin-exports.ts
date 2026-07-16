import { pgTable, serial, text, integer, numeric, date, timestamp } from "drizzle-orm/pg-core";

// 振込データ（全銀ファイル）の出力履歴。
// 「いつ・どのファイルに・どの支払を」含めたかの証跡を残す（二重払い防止のチェック用）。
// 明細は出力時点のスナップショット（仕入先名・金額）を持ち、支払が消えても履歴は残る。
export const zenginExportsTable = pgTable("zengin_exports", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  executionDate: date("execution_date").notNull(), // 取組日
  paymentCount: integer("payment_count").notNull(),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
  exportedAt: timestamp("exported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const zenginExportItemsTable = pgTable("zengin_export_items", {
  id: serial("id").primaryKey(),
  exportId: integer("export_id")
    .notNull()
    .references(() => zenginExportsTable.id, { onDelete: "cascade" }),
  paymentId: integer("payment_id"), // 参照用（支払が削除されても履歴は保持する）
  vendorName: text("vendor_name").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
});

export type ZenginExport = typeof zenginExportsTable.$inferSelect;
export type ZenginExportItem = typeof zenginExportItemsTable.$inferSelect;
