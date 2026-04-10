import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const constructionHistoriesTable = pgTable("construction_histories", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }).unique(),

  constructionName: text("construction_name"),
  location: text("location"),
  clientName: text("client_name"),
  contractAmount: numeric("contract_amount", { precision: 15, scale: 2 }),
  startDate: date("start_date"),
  endDate: date("end_date"),

  constructionType: text("construction_type"),
  contractType: text("contract_type"),
  primeContractorName: text("prime_contractor_name"),

  engineer1Category: text("engineer1_category"),
  engineer1Name: text("engineer1_name"),
  engineer1Qualification: text("engineer1_qualification"),
  engineer1LicenseNumber: text("engineer1_license_number"),

  specialist1WorkContent: text("specialist1_work_content"),
  specialist1Name: text("specialist1_name"),
  specialist1Qualification: text("specialist1_qualification"),

  remarks: text("remarks"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConstructionHistory = typeof constructionHistoriesTable.$inferSelect;
export type InsertConstructionHistory = typeof constructionHistoriesTable.$inferInsert;
