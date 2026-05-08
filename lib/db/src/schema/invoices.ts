import { pgTable, serial, text, numeric, date, integer, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { clientsTable } from "./clients";
import { budgetItemsTable } from "./budget-items";

export const invoiceStatusEnum = ["unpaid", "partial", "paid"] as const;
export type InvoiceStatus = typeof invoiceStatusEnum[number];

export const billingTypeEnum = ["full", "progress"] as const;
export type BillingType = typeof billingTypeEnum[number];

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date"),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull().default(""),
  clientAddress: text("client_address").default(""),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  projectName: text("project_name").default(""),
  invoiceRegistrationNumber: text("invoice_registration_number").default(""),
  billingType: text("billing_type").$type<BillingType>().notNull().default("full"),
  taxExcludedAmount10: numeric("tax_excluded_amount_10", { precision: 15, scale: 2 }).notNull().default("0"),
  taxAmount10: numeric("tax_amount_10", { precision: 15, scale: 2 }).notNull().default("0"),
  taxExcludedAmount8: numeric("tax_excluded_amount_8", { precision: 15, scale: 2 }).notNull().default("0"),
  taxAmount8: numeric("tax_amount_8", { precision: 15, scale: 2 }).notNull().default("0"),
  taxExcludedTotal: numeric("tax_excluded_total", { precision: 15, scale: 2 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 15, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  status: text("status").$type<InvoiceStatus>().notNull().default("unpaid"),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  rowIndex: integer("row_index").notNull().default(0),
  itemName: text("item_name").notNull().default(""),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull().default("1"),
  unit: text("unit").default(""),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull().default("0"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("10"),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  budgetItemId: integer("budget_item_id").references(() => budgetItemsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoicePaymentsTable = pgTable("invoice_payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  paymentDate: date("payment_date").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull().default("振込"),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Invoice = typeof invoicesTable.$inferSelect;
export type InvoiceItem = typeof invoiceItemsTable.$inferSelect;
export type InvoicePayment = typeof invoicePaymentsTable.$inferSelect;
