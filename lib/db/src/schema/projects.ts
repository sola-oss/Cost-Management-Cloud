import { pgTable, serial, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
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
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
