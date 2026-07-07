import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { estimatesTable } from "./estimates";

/**
 * 見積書 印刷履歴 — 見積書を印刷（PDF出力）した記録。
 * いつ印刷したかを残す。「誰が」は担当者マスタ導入後に staffId を後付け予定。
 */
export const estimatePrintLogsTable = pgTable("estimate_print_logs", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id")
    .notNull()
    .references(() => estimatesTable.id, { onDelete: "cascade" }),
  printedAt: timestamp("printed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EstimatePrintLog = typeof estimatePrintLogsTable.$inferSelect;
