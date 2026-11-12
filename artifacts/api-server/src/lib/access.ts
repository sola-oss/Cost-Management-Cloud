import type { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  projectsTable,
  subcontractEstimatesTable,
  receivedInvoiceRecipientsTable,
  type UserRole,
} from "@workspace/db";

// ─── 役割ごとに見られる範囲 ─────────────────────────────────────────────────
//
// 温品様の質問（2026-11-12）：経営者と管理者と一般で権限を分けているか。→ 分ける。
//   admin（経営者）  … すべて
//   manager（管理者）… 経営画面（会社全体の粗利）とユーザー管理以外すべて
//   field（一般）    … 自分が担当の工事だけ。他の人の現場・会社全体の数字・マスタの変更・ユーザー管理は不可
//
// 一般は「許したものだけ通す」。新しいAPIを足したとき、うっかり現場に見えてしまうのを防ぐため。
// 自分の工事かどうかは、工事の担当者（projects.site_manager の名前）がログインに紐づけた担当者の名前と同じかで見る。

export interface Access {
  userId: number | null;
  role: UserRole;
  staffMemberId: number | null;
  staffName: string | null;
}

export function getAccess(req: Request): Access {
  return (req as Request & { access?: Access }).access ?? {
    userId: null, role: "admin", staffMemberId: null, staffName: null,
  };
}

export function setAccess(req: Request, access: Access) {
  (req as Request & { access?: Access }).access = access;
}

function deny(res: Response) {
  res.status(403).json({ message: "この操作をする権限がありません" });
}

// Express 5 では req.query が読み取り専用なので、置き換えるときは定義し直す
function overrideQuery(req: Request, patch: Record<string, string>) {
  Object.defineProperty(req, "query", {
    value: { ...(req.query as Record<string, unknown>), ...patch },
    writable: true,
    configurable: true,
  });
}

async function isOwnProject(access: Access, projectId: number): Promise<boolean> {
  if (!access.staffName || !Number.isInteger(projectId)) return false;
  const [p] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.siteManager, access.staffName)));
  return !!p;
}

async function isRecipient(access: Access, receivedInvoiceId: number): Promise<boolean> {
  if (!access.staffMemberId || !Number.isInteger(receivedInvoiceId)) return false;
  const [r] = await db
    .select({ id: receivedInvoiceRecipientsTable.id })
    .from(receivedInvoiceRecipientsTable)
    .where(and(
      eq(receivedInvoiceRecipientsTable.receivedInvoiceId, receivedInvoiceId),
      eq(receivedInvoiceRecipientsTable.staffMemberId, access.staffMemberId),
    ));
  return !!r;
}

// 一般でも読める表（工事の入力欄の選択肢に使う）。読むだけ。
const FIELD_READABLE_MASTERS = [
  "/staff-members", "/work-types", "/vendors", "/vendor-groups", "/clients",
  "/construction-categories", "/company-settings", "/unit-prices",
];

// 経営画面（会社全体の粗利・原価）。経営者だけ。
const OWNER_ONLY_PREFIXES = [
  "/executive", "/dashboard/overview", "/dashboard/cost-by-category", "/dashboard/monthly-costs",
];

function matchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(prefix + "/");
}

async function fieldAllowed(req: Request, access: Access): Promise<boolean> {
  const m = req.method;
  const path = req.path.replace(/\/+$/, "") || "/";
  const q = req.query as Record<string, string | undefined>;
  const qProject = Number(q["projectId"]);
  const seg = path.split("/").filter(Boolean); // 例 ["projects","12","documents"]

  if (m === "GET" && FIELD_READABLE_MASTERS.some((p) => matchesPrefix(path, p))) return true;

  // 工事一覧：自分が担当の工事だけに絞る（担当者が紐づいていなければ何も出ない）
  if (m === "GET" && path === "/projects") {
    overrideQuery(req, { siteManager: access.staffName ?? "\u0000紐づけなし" });
    return true;
  }

  // 工事ごとの画面：自分の工事なら、見るのはすべて可。書き込みは決めたものだけ
  if (seg[0] === "projects" && seg[1] && /^\d+$/.test(seg[1])) {
    if (!(await isOwnProject(access, Number(seg[1])))) return false;
    const sub = seg.slice(2).join("/");
    if (m === "GET") return true;
    if (m === "POST" && sub === "promote") return true; // 部門を選んで本登録（部門は現場が決める）
    if (m === "PUT" && sub === "progress") return true; // 出来高の入力
    return false; // 工事の編集・削除、実行予算の変更は事務
  }

  if (path === "/attendances" || path === "/attendances/summary") {
    if (m === "GET") return isOwnProject(access, qProject);
    if (m === "PUT" && path === "/attendances") return isOwnProject(access, Number(req.body?.projectId));
    return false;
  }

  if (seg[0] === "cost-sheet" && seg[1]) {
    if (m === "GET" && seg.length === 2) return isOwnProject(access, Number(seg[1]));
    if (m === "PUT" && seg[2] === "rates") return isOwnProject(access, Number(seg[1]));
    return false;
  }

  if (m === "GET" && (path === "/cost-items" || path === "/cost-stage-links" ||
      path === "/subcontract-estimates" || path === "/dashboard/budget-vs-actual")) {
    return isOwnProject(access, qProject);
  }

  if (m === "GET" && seg[0] === "subcontract-estimates" && seg[2] === "file") {
    const [e] = await db
      .select({ projectId: subcontractEstimatesTable.projectId })
      .from(subcontractEstimatesTable)
      .where(eq(subcontractEstimatesTable.id, Number(seg[1])));
    return !!e && isOwnProject(access, e.projectId);
  }

  // 仕入の振り分け：自分に送られてきた書類だけ。誰が選んだかは本人に固定する
  if (seg[0] === "received-invoices") {
    if (!access.staffMemberId) return false;
    if (m === "GET" && seg.length === 1) {
      overrideQuery(req, { staffMemberId: String(access.staffMemberId) });
      return true;
    }
    const id = Number(seg[1]);
    if (!(await isRecipient(access, id))) return false;
    if (m === "GET" && (seg.length === 2 || seg[2] === "file")) return true;
    if ((m === "PATCH" && seg[2] === "assign") || (m === "POST" && seg[2] === "respond")) {
      if (req.body && typeof req.body === "object") req.body.staffMemberId = access.staffMemberId;
      return true;
    }
    return false;
  }

  return false;
}

/** /api の入口で、役割ごとに通すかを決める（ログイン確認のあと） */
export async function enforceRole(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  if (path.startsWith("/auth/") || path === "/health" || path.startsWith("/health")) return next();
  const access = getAccess(req);
  try {
    if (access.role === "admin") return next();

    // ユーザー管理は経営者だけ（管理者が自分の権限を上げられないように）
    if (matchesPrefix(path, "/users")) return deny(res);
    if (OWNER_ONLY_PREFIXES.some((p) => matchesPrefix(path, p))) return deny(res);
    if (access.role === "manager") return next();

    if (await fieldAllowed(req, access)) return next();
    return deny(res);
  } catch (err) {
    req.log.error({ err }, "Failed to check role");
    res.status(500).json({ message: "権限の確認に失敗しました" });
  }
}
