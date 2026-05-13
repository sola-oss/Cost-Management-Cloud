import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const companySettingsTable = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull().default(""),
  postalCode: text("postal_code").default(""),
  address: text("address").default(""),
  tel: text("tel").default(""),
  fax: text("fax").default(""),
  invoiceRegistrationNumber: text("invoice_registration_number").default(""),
  representativeName: text("representative_name").default(""),
  department: text("department").default(""),
  bankName: text("bank_name").default(""),
  bankBranch: text("bank_branch").default(""),
  bankAccountType: text("bank_account_type").default("普通"),
  bankAccountNumber: text("bank_account_number").default(""),
  bankAccountName: text("bank_account_name").default(""),
  constructionLicense: text("construction_license").default(""),
  staffName: text("staff_name").default(""),
  staffMobile: text("staff_mobile").default(""),
  staffEmail: text("staff_email").default(""),
  // 全銀フォーマット用
  consignorCode: text("consignor_code").default(""),
  companyNameKana: text("company_name_kana").default(""),
  bankCode: text("bank_code").default(""),
  bankNameKana: text("bank_name_kana").default(""),
  bankBranchCode: text("bank_branch_code").default(""),
  bankBranchKana: text("bank_branch_kana").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CompanySettings = typeof companySettingsTable.$inferSelect;
