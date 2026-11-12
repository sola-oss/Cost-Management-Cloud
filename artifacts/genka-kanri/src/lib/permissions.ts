import { useAuthStatus } from "@/hooks/use-auth";

// ─── 役割ごとに開ける画面 ───────────────────────────────────────────────────
//
// 経営者（admin）… すべて
// 管理者（manager）… 経営画面（ダッシュボード）とユーザー管理以外すべて
// 一般（field）… 自分が担当の工事・自分の現場・自分に届いた仕入の振り分けだけ
// 本当の守りはAPI側（api-server/src/lib/access.ts）。ここは見せない・迷わせないため。

export type Role = "admin" | "manager" | "field";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "経営者",
  manager: "管理者",
  field: "一般（現場）",
};

export function toRole(v: string | undefined | null): Role {
  return v === "admin" || v === "manager" || v === "field" ? v : "field";
}

/** 今の人の役割。ログイン不要で動いているとき（ローカル確認など）は経営者扱い */
export function useRole(): Role {
  const { data } = useAuthStatus();
  if (!data?.authRequired) return "admin";
  return toRole(data.user?.role);
}

const FIELD_PATHS: RegExp[] = [
  /^\/projects$/,
  /^\/projects\/\d+$/,
  /^\/projects\/\d+\/(budgets|ledger)$/,
  /^\/my-projects$/,
  /^\/received-invoices\/\d+$/,
  /^\/account$/,
];

export function pathAllowed(role: Role, path: string): boolean {
  const p = path.replace(/\/+$/, "") || "/";
  if (role === "admin") return true;
  if (role === "manager") return p !== "/" && !p.startsWith("/master/users");
  return FIELD_PATHS.some((re) => re.test(p));
}

/** ログインしたとき最初に開く画面 */
export function homePath(role: Role): string {
  return role === "admin" ? "/" : role === "manager" ? "/projects" : "/my-projects";
}
