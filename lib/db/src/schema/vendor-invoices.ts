import { pgTable, serial, text, numeric, date, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";
import { projectsTable } from "./projects";

export const vendorInvoiceStatusEnum = ["pending", "confirmed"] as const;
export type VendorInvoiceStatus = typeof vendorInvoiceStatusEnum[number];

export const vendorInvoicesTable = pgTable("vendor_invoices", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date").notNull(),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
  notes: text("notes"),
  status: text("status").$type<VendorInvoiceStatus>().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVendorInvoiceSchema = createInsertSchema(vendorInvoicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVendorInvoice = z.infer<typeof insertVendorInvoiceSchema>;
export type VendorInvoice = typeof vendorInvoicesTable.$inferSelect;
