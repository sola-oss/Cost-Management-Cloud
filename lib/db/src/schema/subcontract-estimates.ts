import { pgTable, serial, text, numeric, date, integer, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { vendorsTable } from "./vendors";

// ③下請見積書。スキャンして実行予算（budget_items）に入れた見積書1枚ぶん。
// 実行予算の行は budget_items.subcontract_estimate_id でここに戻れる（原本・印字の額・決定額）。
// 見積書は印字の合計と実際に決まった額が違うことが多い（手書きの「改メ」・Net価格）。
// 実行予算には決定額を工種ごとに割り振って入れ、印字の額もここに残して後から比べられるようにする。
export const subcontractEstimatesTable = pgTable("subcontract_estimates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  vendorName: text("vendor_name").notNull().default(""),
  estimateNumber: text("estimate_number"),
  estimateDate: date("estimate_date"),
  // どちらも税抜
  printedTotal: numeric("printed_total", { precision: 15, scale: 2 }).notNull().default("0"),
  decidedTotal: numeric("decided_total", { precision: 15, scale: 2 }).notNull().default("0"),
  filePath: text("file_path"),
  mediaType: text("media_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubcontractEstimate = typeof subcontractEstimatesTable.$inferSelect;
