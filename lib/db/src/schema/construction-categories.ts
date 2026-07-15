import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// 工事分類マスタ（レッツの「工事分類」由来。NSSC/戸建住宅/官公庁など受注先・市場の分類）。
// 工事の category1 にはこのマスタの name を文字列で保存する（既存列を流用）。
export const constructionCategoriesTable = pgTable("construction_categories", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertConstructionCategorySchema = createInsertSchema(constructionCategoriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertConstructionCategory = z.infer<typeof insertConstructionCategorySchema>;
export type ConstructionCategory = typeof constructionCategoriesTable.$inferSelect;
