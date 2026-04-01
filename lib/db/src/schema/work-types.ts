import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workTypesTable = pgTable("work_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWorkTypeSchema = createInsertSchema(workTypesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWorkType = z.infer<typeof insertWorkTypeSchema>;
export type WorkType = typeof workTypesTable.$inferSelect;
