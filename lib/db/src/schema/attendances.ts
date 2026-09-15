import { pgTable, serial, integer, date, numeric, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { staffMembersTable } from "./staff-members";

// ─── 出面（でづら）────────────────────────────────────────────────────────────
//
// おおつか様の依頼（2026-09-10）の4-3。現場ごとに「誰が何日入ったか」を見えるようにする。
// 現行のExcelは工事ごとにシートを分け、社員 × 日で 工数／早出／残業 を書いている。
// ここでは 1行 = 1人・1日 として、その3つを持つ。
//
// 金額（人工 × 単価）は出していない。職人単価をシステムに持てるかが未確定のため
// （温品様へ確認中）。日数が入っていれば、単価が決まった時点で金額は足せる。
export const attendancesTable = pgTable(
  "attendances",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    staffMemberId: integer("staff_member_id").notNull().references(() => staffMembersTable.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    // 人工。半日は 0.5
    manDays: numeric("man_days", { precision: 5, scale: 2 }).notNull().default("0"),
    earlyCount: numeric("early_count", { precision: 5, scale: 2 }).notNull().default("0"),
    overtimeCount: numeric("overtime_count", { precision: 5, scale: 2 }).notNull().default("0"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("attendances_unique").on(t.projectId, t.staffMemberId, t.workDate),
    index("attendances_project_date_idx").on(t.projectId, t.workDate),
  ],
);

export const insertAttendanceSchema = createInsertSchema(attendancesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendancesTable.$inferSelect;
