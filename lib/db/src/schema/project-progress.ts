import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

// ─── 工事の出来高（進捗率）の月次履歴 ─────────────────────────────────────────
//
// なぜ履歴が要るか：原価だけ入って出来高が入らないと、工事中の粗利は必ず赤字に見える
// （材料は先に入るのに売上は完成まで立たないため）。予実を正しく見るには
// 「いつ時点で何%か」が要る。さらに着地見込みの計算にも過去の推移が要る。
//
// projects.progress_rate は「最新の進捗率」として残す（実行予算画面・工事台帳が参照）。
// このテーブルはその月次スナップショット。入力時に両方を更新する。

export const projectProgressRecordsTable = pgTable("project_progress_records", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  // 対象年月 "YYYY-MM"。月に1回の入力なので月単位で一意にする。
  yearMonth: text("year_month").notNull(),
  // 0〜100。画面では5%刻みで入れてもらう（1%刻みは考えすぎて手が止まるため）。
  progressRate: integer("progress_rate").notNull(),
  // 前月より下げるときの理由（下げるのは事務が理由付きで行う運用）。
  note: text("note"),
  // 入力した担当者名（staff_members.name を文字列で持つ。projects.siteManager と同じ方式）。
  recordedBy: text("recorded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // 同じ工事の同じ月は1行だけ（入力し直しは更新になる）
  uniqProjectMonth: unique("uq_project_progress_month").on(t.projectId, t.yearMonth),
}));

export const insertProjectProgressRecordSchema = createInsertSchema(projectProgressRecordsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProjectProgressRecord = z.infer<typeof insertProjectProgressRecordSchema>;
export type ProjectProgressRecord = typeof projectProgressRecordsTable.$inferSelect;
