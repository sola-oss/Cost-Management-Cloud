import { pgTable, serial, text, boolean, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

// ─── 職人マスタ ──────────────────────────────────────────────────────────────
//
// 温品様の依頼（2026-11-13）：出面に出す職人をマスタ管理で登録したい。
// 担当者マスタ（工事担当・ログインする人）とは別。ログインしない、現場に入る人の一覧。
// Excel の「班名」の列に書いていた名前（人の名前や「大屋根」のような班）をそのまま名前にする。
export const craftsmenTable = pgTable("craftsmen", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  // 在籍=true / やめた=false。やめた人は選べなくなるが、過去の出面はそのまま残る
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Craftsman = typeof craftsmenTable.$inferSelect;

// 現場ごとに「この現場に入る職人」（温品様の依頼 2026-11-13）。出面と工事原価計算書の労務費に並ぶ人
export const projectCraftsmenTable = pgTable(
  "project_craftsmen",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    craftsmanId: integer("craftsman_id").notNull().references(() => craftsmenTable.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("project_craftsmen_unique").on(t.projectId, t.craftsmanId)],
);
