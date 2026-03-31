import { pgTable, serial, text, numeric, date, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectStatusEnum = ["planning", "active", "completed", "suspended"] as const;
export type ProjectStatus = typeof projectStatusEnum[number];

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  projectCode: text("project_code").notNull().unique(),
  name: text("name").notNull(),
  clientName: text("client_name").notNull(),
  location: text("location").notNull(),
  contractAmount: numeric("contract_amount", { precision: 15, scale: 2 }).notNull(),
  status: text("status").$type<ProjectStatus>().notNull().default("planning"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  completedDate: date("completed_date"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  shortName: text("short_name"),
  estimateNumber: text("estimate_number"),
  orderType: text("order_type"),
  orderDate: date("order_date"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }),
  taxExcludedAmount: numeric("tax_excluded_amount", { precision: 15, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }),
  taxIncludedAmount: numeric("tax_included_amount", { precision: 15, scale: 2 }),
  overview: text("overview"),
  department: text("department"),
  salesStaff: text("sales_staff"),
  siteManager: text("site_manager"),
  category1: text("category1"),
  category2: text("category2"),
  category3: text("category3"),
  handoverDate: date("handover_date"),
  progressRate: integer("progress_rate"),
  recognitionBasis: text("recognition_basis"),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
