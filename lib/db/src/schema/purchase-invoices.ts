import { pgTable, serial, text, numeric, date, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { vendorsTable } from "./vendors";
import { workTypesTable } from "./work-types";
import { purchaseOrdersTable, purchaseOrderItemsTable } from "./purchase-orders";
import { CostCategory } from "./cost-items";

export const purchaseInvoiceStatusEnum = ["provisional", "confirmed", "assessed", "paid", "cancelled"] as const;
export type PurchaseInvoiceStatus = typeof purchaseInvoiceStatusEnum[number];

export const taxCalculationMethodEnum = ["detail_exclusive", "detail_inclusive", "total_exclusive"] as const;
export type TaxCalculationMethod = typeof taxCalculationMethodEnum[number];

export const purchaseInvoicesTable = pgTable("purchase_invoices", {
  id: serial("id").primaryKey(),
  voucherNumber: text("voucher_number").notNull().unique(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id, { onDelete: "set null" }),
  purchaseDate: date("purchase_date").notNull(),
  paymentDueDate: date("payment_due_date"),
  status: text("status").$type<PurchaseInvoiceStatus>().notNull().default("confirmed"),
  taxCalculationMethod: text("tax_calculation_method").$type<TaxCalculationMethod>().notNull().default("detail_exclusive"),
  isProvisional: boolean("is_provisional").notNull().default(false),
  invoiceRegistrationNumber: text("invoice_registration_number"),
  isTaxableInvoice: boolean("is_taxable_invoice").notNull().default(true),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  // 支払査定で確定済みになった日時（NULL = 未査定）。集計時に査定済みを除外して二重査定を防ぐ
  assessedAt: timestamp("assessed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseInvoiceItemsTable = pgTable("purchase_invoice_items", {
  id: serial("id").primaryKey(),
  purchaseInvoiceId: integer("purchase_invoice_id").notNull().references(() => purchaseInvoicesTable.id, { onDelete: "cascade" }),
  purchaseOrderItemId: integer("purchase_order_item_id").references(() => purchaseOrderItemsTable.id, { onDelete: "set null" }),
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
  costItemId: integer("cost_item_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPurchaseInvoiceSchema = createInsertSchema(purchaseInvoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseInvoice = z.infer<typeof insertPurchaseInvoiceSchema>;
export type PurchaseInvoice = typeof purchaseInvoicesTable.$inferSelect;

export const insertPurchaseInvoiceItemSchema = createInsertSchema(purchaseInvoiceItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseInvoiceItem = z.infer<typeof insertPurchaseInvoiceItemSchema>;
export type PurchaseInvoiceItem = typeof purchaseInvoiceItemsTable.$inferSelect;
