import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * 見積書・請求書に印刷する振込先口座（入金してもらう口座）。複数登録できる。
 *
 * company_settings 側の銀行項目とは別物なので注意：
 * あちらは振込データ（全銀ファイル）の引落口座＝こちらが支払うときの出金元で、
 * 銀行コード・支店コード・カナが要る。こちらは得意先に振り込んでもらう先で、
 * 印刷するだけなので名称があればよい。
 */
export const companyBankAccountsTable = pgTable("company_bank_accounts", {
  id: serial("id").primaryKey(),
  // 請求書に並べる順番（小さいほど上）
  displayOrder: integer("display_order").notNull().default(0),
  bankName: text("bank_name").notNull().default(""),
  bankBranch: text("bank_branch").notNull().default(""),
  accountType: text("account_type").notNull().default("普通"),
  accountNumber: text("account_number").notNull().default(""),
  accountHolder: text("account_holder").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompanyBankAccountSchema = createInsertSchema(companyBankAccountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompanyBankAccount = z.infer<typeof insertCompanyBankAccountSchema>;
export type CompanyBankAccount = typeof companyBankAccountsTable.$inferSelect;
