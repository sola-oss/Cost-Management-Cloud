import { pgTable, serial, text, numeric, date, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { vendorsTable } from "./vendors";
import { staffMembersTable } from "./staff-members";
import { workTypesTable } from "./work-types";
import { CostCategory } from "./cost-items";

// ─── 受領請求書（仮デジタル請求書）───────────────────────────────────────────
//
// 下請から届いた請求書1枚を原本として持つ。1枚に複数工事が混ざるため、工事は
// ヘッダではなく明細行ごとに持たせる（現場担当者が明細ごとに工事を選ぶ）。
// 事務がアップロード → AIがデータ化 → 現場担当者が工事を割当 → 事務が確定 の順で
// status が進む。確定すると、工事ごとにグループ化して purchase_invoices を生成する。
//
// 支払は会計ソフト側で行うため、このテーブルは原価の入口に専念する。

export const receivedInvoiceStatusEnum = ["draft", "sent", "answered", "confirmed", "cancelled"] as const;
export type ReceivedInvoiceStatus = typeof receivedInvoiceStatusEnum[number];
// draft     … AI抽出直後 or 手入力中。まだ現場に送っていない
// sent      … 現場担当者に送信済（回答待ち）
// answered  … 全ブロックに工事が割り当てられた（未割当ゼロ。事務の確認待ち）
// confirmed … 事務が確認して確定。仕入伝票(purchase_invoices)を生成済み
// cancelled … 取り消し

export const receivedInvoicesTable = pgTable("received_invoices", {
  id: serial("id").primaryKey(),
  // 仕入先。AI抽出時点では未確定なので nullable。vendorName に抽出した会社名を保持し、
  // 事務がマスタに突合して vendorId を確定する。
  vendorId: integer("vendor_id").references(() => vendorsTable.id),
  vendorName: text("vendor_name").notNull().default(""),
  invoiceDate: date("invoice_date"),
  paymentDueDate: date("payment_due_date"),
  status: text("status").$type<ReceivedInvoiceStatus>().notNull().default("draft"),
  // AIで読み取ったか、手入力か。手入力の逃げ道を使った場合は false。
  aiExtracted: boolean("ai_extracted").notNull().default(false),
  // 明細合計と請求総額が一致しないと true（コード側の検算結果）。確定前の安全網。
  amountMismatch: boolean("amount_mismatch").notNull().default(false),
  // 原本のスキャン画像/PDF。保存先はRailwayボリュームかオブジェクトストレージをAPI側で決める。
  // ここにはその参照キー（ファイルパス or file_id）とMIMEタイプを持つ。
  filePath: text("file_path"),
  mediaType: text("media_type"),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  // 現場に送信した日時（NULL = 未送信）。未回答一覧の経過日数計算に使う。
  sentAt: timestamp("sent_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const receivedInvoiceItemsTable = pgTable("received_invoice_items", {
  id: serial("id").primaryKey(),
  receivedInvoiceId: integer("received_invoice_id").notNull().references(() => receivedInvoicesTable.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(),
  // 伝票番号/納品書番号。これが同じ行を1ブロックにまとめる。無ければ null → UIで1行=1ブロック。
  slipNo: text("slip_no"),
  deliveryDate: date("delivery_date"),
  // 納品先の印字（例: 大田鋼管の摘要「有間様邸」）。現場担当者が工事を選ぶ手掛かり。
  deliveryTo: text("delivery_to"),
  category: text("category").$type<CostCategory>().notNull().default("material"),
  // 工種。確定時に仕入伝票へ引き継ぎ、工種別の予算・実績に載せる。
  // ここが空だと原価が「未分類（予算なし）」に落ちて工種別の予算残から漏れる。
  workTypeId: integer("work_type_id").references(() => workTypesTable.id, { onDelete: "set null" }),
  description: text("description").notNull().default(""),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unit: text("unit").notNull().default(""),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull().default("0"),
  // 金額。返品・値引のマイナス行を許容するため負値もそのまま入れる。
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("10"),
  // 現場担当者が割り当てる工事。割当前は null。
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  // 仕入でない行（入金・繰越・値引・小計・合計・消費税等）。集計・確定・割当対象から除外する。
  // いわさき工房の「入金 振込 -43,670」のような相殺行を原価に取り込まないための旗。
  isNonPurchase: boolean("is_non_purchase").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 送り先（複数）。事務が選ぶ。同じ仮請求書を複数の現場担当者に送れる。
export const receivedInvoiceRecipientsTable = pgTable("received_invoice_recipients", {
  id: serial("id").primaryKey(),
  receivedInvoiceId: integer("received_invoice_id").notNull().references(() => receivedInvoicesTable.id, { onDelete: "cascade" }),
  staffMemberId: integer("staff_member_id").notNull().references(() => staffMembersTable.id),
  // その担当者が回答（送信）した日時。未回答一覧の催促に使う。
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReceivedInvoiceSchema = createInsertSchema(receivedInvoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReceivedInvoice = z.infer<typeof insertReceivedInvoiceSchema>;
export type ReceivedInvoice = typeof receivedInvoicesTable.$inferSelect;

export const insertReceivedInvoiceItemSchema = createInsertSchema(receivedInvoiceItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReceivedInvoiceItem = z.infer<typeof insertReceivedInvoiceItemSchema>;
export type ReceivedInvoiceItem = typeof receivedInvoiceItemsTable.$inferSelect;

export const insertReceivedInvoiceRecipientSchema = createInsertSchema(receivedInvoiceRecipientsTable).omit({ id: true, createdAt: true });
export type InsertReceivedInvoiceRecipient = z.infer<typeof insertReceivedInvoiceRecipientSchema>;
export type ReceivedInvoiceRecipient = typeof receivedInvoiceRecipientsTable.$inferSelect;
