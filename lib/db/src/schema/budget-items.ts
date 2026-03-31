import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const budgetItemsTable = pgTable("budget_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  workTypeCode: text("work_type_code").notNull(),
  workTypeName: text("work_type_name").notNull(),
  supplierName: text("supplier_name").notNull().default(""),
  contractAmount: numeric("contract_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  initialBudget: numeric("initial_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  revisedBudget: numeric("revised_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
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
