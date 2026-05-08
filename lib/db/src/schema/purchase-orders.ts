import { pgTable, serial, text, numeric, date, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { vendorsTable } from "./vendors";
import { workTypesTable } from "./work-types";
import { costCategoryEnum, CostCategory } from "./cost-items";

export const purchaseOrderStatusEnum = ["draft", "ordered", "partial", "completed", "cancelled"] as const;
export type PurchaseOrderStatus = typeof purchaseOrderStatusEnum[number];

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  orderDate: date("order_date").notNull(),
  expectedDeliveryDate: date("expected_delivery_date"),
  status: text("status").$type<PurchaseOrderStatus>().notNull().default("draft"),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrderItemsTable = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(),
  category: text("category").$type<CostCategory>().notNull(),
  workTypeId: integer("work_type_id").references(() => workTypesTable.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  specification: text("specification"),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unit: text("unit").notNull().default(""),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull().default("0"),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("10"),
  deliveredQuantity: numeric("delivered_quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;

export const insertPurchaseOrderItemSchema = createInsertSchema(purchaseOrderItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseOrderItem = z.infer<typeof insertPurchaseOrderItemSchema>;
export type PurchaseOrderItem = typeof purchaseOrderItemsTable.$inferSelect;
