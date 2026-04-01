import { pgTable, serial, text, numeric, date, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const estimateStatusEnum = ["draft", "submitted", "approved", "lost"] as const;
export type EstimateStatus = typeof estimateStatusEnum[number];

export const estimatesTable = pgTable("estimates", {
  id: serial("id").primaryKey(),
  estimateNumber: text("estimate_number").notNull().unique(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  estimateDate: date("estimate_date").notNull(),
  createdDate: date("created_date"),
  clientName: text("client_name").notNull().default(""),
  clientAddress: text("client_address").default(""),
  subject: text("subject").notNull().default(""),
  location: text("location").default(""),
  constructionPeriod: text("construction_period").default(""),
  validityPeriod: text("validity_period").default("見積日より1ヶ月"),
  paymentTerms: text("payment_terms").default("別途契約書通り"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("10"),
  taxExcludedAmount: numeric("tax_excluded_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  taxIncludedAmount: numeric("tax_included_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  status: text("status").$type<EstimateStatus>().notNull().default("draft"),
  notes: text("notes").default(""),
  architectFirm: text("architect_firm").default(""),
  companyName: text("company_name").default(""),
  companyAddress: text("company_address").default(""),
  companyTel: text("company_tel").default(""),
  companyFax: text("company_fax").default(""),
  companyStaff: text("company_staff").default(""),
  department: text("department").default(""),
  memo: text("memo").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// level: 1=大, 2=中, 3=小, 4=細, 5=商品
// rowType: normal=通常, discount=値引, total=合計, tax=消費税, pagebreak=改ページ
export const estimateItemRowTypeEnum = ["normal", "discount", "total", "tax", "pagebreak"] as const;
export type EstimateItemRowType = typeof estimateItemRowTypeEnum[number];

export const estimateItemsTable = pgTable("estimate_items", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull().references(() => estimatesTable.id, { onDelete: "cascade" }),
  rowIndex: integer("row_index").notNull().default(0),
  level: integer("level").notNull().default(1),
  workType: text("work_type").default(""),
  itemName: text("item_name").default(""),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).default("0"),
  unit: text("unit").default(""),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).default("0"),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  rowType: text("row_type").$type<EstimateItemRowType>().notNull().default("normal"),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEstimateSchema = createInsertSchema(estimatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEstimateItemSchema = createInsertSchema(estimateItemsTable).omit({ id: true, createdAt: true });
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimatesTable.$inferSelect;
export type EstimateItem = typeof estimateItemsTable.$inferSelect;
