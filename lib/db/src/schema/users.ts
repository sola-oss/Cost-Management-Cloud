import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { staffMembersTable } from "./staff-members";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ログインアカウント。権限は role 文字列で持つ。
//   admin   … 経営者。すべて見られる（2026-11-12 以前からいる人は全員これ）
//   manager … 管理者（事務）。経営画面（会社全体の粗利）とユーザー管理以外すべて
//   field   … 一般（現場）。自分が担当の工事だけ（工事の担当者＝staffMemberId の名前）
export const USER_ROLES = ["admin", "manager", "field"] as const;
export type UserRole = typeof USER_ROLES[number];
export function isUserRole(v: unknown): v is UserRole {
  return typeof v === "string" && (USER_ROLES as readonly string[]).includes(v);
}
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  // このログインがどの担当者か。一般（現場）は、この担当者が受け持つ工事だけを見られる。
  staffMemberId: integer("staff_member_id").references(() => staffMembersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
