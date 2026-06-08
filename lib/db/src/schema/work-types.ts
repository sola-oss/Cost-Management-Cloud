import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vendorsTable } from "./vendors";

export const workTypesTable = pgTable("work_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  constructionType: text("construction_type").notNull().default("その他"),
  notes: text("notes"),
  // 標準仕入先：見積取込時にこの工種の予算行へ自動セットされる
  defaultVendorId: integer("default_vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWorkTypeSchema = createInsertSchema(workTypesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWorkType = z.infer<typeof insertWorkTypeSchema>;
export type WorkType = typeof workTypesTable.$inferSelect;
