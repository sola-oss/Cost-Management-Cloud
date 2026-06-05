import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { workTypesTable } from "./work-types";

/**
 * 単価マスタ — 仕入先 × 工種 × 品目 → 単価
 *
 * 仕入入力・実行予算で仕入先＋品目を選んだ際に
 * 単価を自動補完するためのマスタテーブル。
 */
export const unitPricesTable = pgTable("unit_prices", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  workTypeId: integer("work_type_id")
    .references(() => workTypesTable.id, { onDelete: "set null" }),
  itemName: text("item_name").notNull(),
  unit: text("unit").notNull().default("式"),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUnitPriceSchema = createInsertSchema(unitPricesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUnitPrice = z.infer<typeof insertUnitPriceSchema>;
export type UnitPrice = typeof unitPricesTable.$inferSelect;
