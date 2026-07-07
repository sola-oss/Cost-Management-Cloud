import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vendorGroupsTable = pgTable("vendor_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVendorGroupSchema = createInsertSchema(vendorGroupsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVendorGroup = z.infer<typeof insertVendorGroupSchema>;
export type VendorGroup = typeof vendorGroupsTable.$inferSelect;

export const vendorsTable = pgTable("vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  groupId: integer("group_id").references(() => vendorGroupsTable.id, { onDelete: "set null" }),
  address: text("address").default(""),
  closingDay: integer("closing_day").notNull().default(99),
  paymentMonths: integer("payment_months").notNull().default(1),
  paymentDay: integer("payment_day").notNull().default(25),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  // インボイス制度 適格請求書発行事業者登録番号
  invoiceRegistrationNumber: text("invoice_registration_number").default(""),
  // 振込先口座情報（全銀フォーマット用）
  bankCode: text("bank_code").default(""),
  bankName: text("bank_name").default(""),
  bankNameKana: text("bank_name_kana").default(""),
  bankBranchCode: text("bank_branch_code").default(""),
  bankBranch: text("bank_branch").default(""),
  bankBranchKana: text("bank_branch_kana").default(""),
  bankAccountType: text("bank_account_type").default("普通"),
  bankAccountNumber: text("bank_account_number").default(""),
  bankAccountHolder: text("bank_account_holder").default(""),
  bankAccountHolderKana: text("bank_account_holder_kana").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVendorSchema = createInsertSchema(vendorsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendorsTable.$inferSelect;
