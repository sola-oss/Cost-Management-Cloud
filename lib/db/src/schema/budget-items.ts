import { pgTable, serial, text, numeric, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { vendorsTable } from "./vendors";
import { purchaseOrdersTable, purchaseOrderItemsTable } from "./purchase-orders";

export const budgetItemsTable = pgTable("budget_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  workTypeCode: text("work_type_code").notNull(),
  workTypeName: text("work_type_name").notNull(),
  supplierCode: text("supplier_code").notNull().default(""),
  supplierName: text("supplier_name").notNull().default(""),
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  contractAmount: numeric("contract_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  initialBudget: numeric("initial_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  revisedBudget: numeric("revised_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  isOriginalLocked: boolean("is_original_locked").notNull().default(false),
  originalBudgetAmount: numeric("original_budget_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id, { onDelete: "set null" }),
  purchaseOrderItemId: integer("purchase_order_item_id").references(() => purchaseOrderItemsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBudgetItemSchema = createInsertSchema(budgetItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBudgetItem = z.infer<typeof insertBudgetItemSchema>;
export type BudgetItem = typeof budgetItemsTable.$inferSelect;
