import { pgTable, serial, text, numeric, date, integer, timestamp, boolean, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// provisional = 仮登録。工事名だけで作った受け皿で、会社全体の合計・粗利には入れない。
// 本登録（POST /api/projects/:id/promote）で planning（小口は active）になる。
export const projectStatusEnum = ["provisional", "planning", "active", "completed", "suspended"] as const;
export type ProjectStatus = typeof projectStatusEnum[number];

// 管理区分。small =「その他（小口工事）」。
// 金額の小さい工事まで実行予算・出来高を作るのは手間に合わないため、
// 工事名・請負金額・担当者だけで登録し、粗利は「請負 − 実績原価」で見る。
// 全体の売上・原価・粗利には通常工事と同じように含める（入れないと全体が分からないため）。
export const projectManagementTypeEnum = ["normal", "small"] as const;
export type ProjectManagementType = typeof projectManagementTypeEnum[number];

// 部門。MF会計の仕訳に使うため、工事の登録時に必須で選び、一度決めたら変えさせない
// （後から変わると、すでに入れた仕訳と食い違う）。おおつか様の依頼 2026-09-30。
// 画面側（genka-kanri/src/lib/departments.ts）にも同じ一覧がある。増やすときは両方。
export const projectDepartmentEnum = ["おおつか", "冨士岡工務店"] as const;
export type ProjectDepartment = typeof projectDepartmentEnum[number];
export const isProjectDepartment = (v: unknown): v is ProjectDepartment =>
  typeof v === "string" && (projectDepartmentEnum as readonly string[]).includes(v);

export type ContractLine = {
  contractDate: string | null;
  taxExcludedAmount: number | null;
};

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  projectCode: text("project_code").notNull().unique(),
  name: text("name").notNull(),
  clientName: text("client_name").notNull(),
  location: text("location").notNull(),
  contractAmount: numeric("contract_amount", { precision: 15, scale: 2 }).notNull(),
  status: text("status").$type<ProjectStatus>().notNull().default("planning"),
  managementType: text("management_type").$type<ProjectManagementType>().notNull().default("normal"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  completedDate: date("completed_date"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  shortName: text("short_name"),
  estimateNumber: text("estimate_number"),
  orderType: text("order_type"),
  orderDate: date("order_date"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }),
  taxExcludedAmount: numeric("tax_excluded_amount", { precision: 15, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }),
  taxIncludedAmount: numeric("tax_included_amount", { precision: 15, scale: 2 }),
  overview: text("overview"),
  department: text("department"),
  salesStaff: text("sales_staff"),
  siteManager: text("site_manager"),
  category1: text("category1"),
  category2: text("category2"),
  category3: text("category3"),
  handoverDate: date("handover_date"),
  progressRate: integer("progress_rate"),
  recognitionBasis: text("recognition_basis"),

  projectCodeBranch: text("project_code_branch"),
  startDateActual: date("start_date_actual"),
  endDateActual: date("end_date_actual"),
  handoverDateActual: date("handover_date_actual"),
  floorAreaTsubo: numeric("floor_area_tsubo", { precision: 10, scale: 2 }),
  floorAreaSqm: numeric("floor_area_sqm", { precision: 10, scale: 2 }),
  memo: text("memo"),
  isCompleted: boolean("is_completed").default(false),
  contractLines: json("contract_lines").$type<ContractLine[]>(),
  publicPrivateType: text("public_private_type"),
  clientCode: text("client_code"),
  constructionHistoryType: text("construction_history_type"),
  constructionHistoryEngineer: text("construction_history_engineer"),

  // ①元請注文書・②客先見積書/契約書をスキャンして登録したときの原本（受領請求書と同じ保存先 received-invoices）
  orderFilePath: text("order_file_path"),
  orderMediaType: text("order_media_type"),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
