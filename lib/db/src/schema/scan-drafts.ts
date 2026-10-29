import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

// スキャンする画面で取り込んだ①元請注文書・②客先見積書/契約書・③下請見積書の下書き。
// まとめて取り込んでおき、あとで1件ずつ開いて確かめてから登録する（④⑤の受領書類と同じ流れ）。
// AIの読み取り結果（ai-extract の返り値そのまま）と原本をここに置き、確認画面はそれを開き直す。
// 登録が済んだら status=done にして、登録先の工事を残す。
export const scanDraftsTable = pgTable("scan_drafts", {
  id: serial("id").primaryKey(),
  // prime-order / client-estimate / subcontract-estimate
  kind: text("kind").notNull(),
  fileName: text("file_name").notNull().default(""),
  filePath: text("file_path"),
  mediaType: text("media_type"),
  extract: jsonb("extract"),
  // 読み取りに失敗したときの理由。確認画面では手で入力してもらう
  error: text("error"),
  status: text("status").notNull().default("draft"),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  doneAt: timestamp("done_at", { withTimezone: true }),
});

export type ScanDraft = typeof scanDraftsTable.$inferSelect;
