import { pgTable, serial, text, numeric, date, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { vendorsTable } from "./vendors";
import { workTypesTable } from "./work-types";

export const costCategoryEnum = ["material", "labor", "subcontract", "expense"] as const;
export type CostCategory = typeof costCategoryEnum[number];

export const costItemsTable = pgTable("cost_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  category: text("category").$type<CostCategory>().notNull(),
  description: text("description").notNull(),
  vendor: text("vendor"),
  quantity: numeric("quantity", { precision: 12, scale: 3 }),
  unit: text("unit"),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  incurredDate: date("incurred_date").notNull(),
  invoiceNumber: text("invoice_number"),
  notes: text("notes"),
  sourceType: text("source_type").$type<"manual" | "purchase_invoice">().notNull().default("manual"),
  sourceId: integer("source_id"),
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  workTypeId: integer("work_type_id").references(() => workTypesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCostItemSchema = createInsertSchema(costItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCostItem = z.infer<typeof insertCostItemSchema>;
export type CostItem = typeof costItemsTable.$inferSelect;
