import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// 担当者マスタ（レッツの「工事担当者一覧」由来。原価を付ける担当者の名前）。
// ログインアカウント(users)とは別物。工事の siteManager には name を文字列で保存する。
// 将来フェーズ3でログイン統合するときは users への昇格を検討する。
export const staffMembersTable = pgTable("staff_members", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStaffMemberSchema = createInsertSchema(staffMembersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStaffMember = z.infer<typeof insertStaffMemberSchema>;
export type StaffMember = typeof staffMembersTable.$inferSelect;
