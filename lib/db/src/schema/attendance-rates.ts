import { pgTable, serial, integer, numeric, timestamp, unique } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { staffMembersTable } from "./staff-members";

// ─── 出面の単価 ──────────────────────────────────────────────────────────────
//
// 温品様の回答（2026-10-02）：出面は金額（人工×単価）まで出す。単価は画面で手入力。
// 現行のExcel（工事原価計算書）は工事ごとのシートに職人ごとの単価と残業の単価を書いているので、
// ここも 工事 × 職人 で持つ。早出は Excel に無いが、出面では数えているので同じく単価を持つ。
export const attendanceRatesTable = pgTable(
  "attendance_rates",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    staffMemberId: integer("staff_member_id").notNull().references(() => staffMembersTable.id, { onDelete: "cascade" }),
    dayRate: numeric("day_rate", { precision: 12, scale: 2 }).notNull().default("0"),
    overtimeRate: numeric("overtime_rate", { precision: 12, scale: 2 }).notNull().default("0"),
    earlyRate: numeric("early_rate", { precision: 12, scale: 2 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("attendance_rates_unique").on(t.projectId, t.staffMemberId)],
);

export type AttendanceRate = typeof attendanceRatesTable.$inferSelect;
