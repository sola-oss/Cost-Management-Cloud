import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { SESSION_COOKIE, isAuthRequired, verifySessionToken } from "../lib/auth";

// AUTH_REQUIRED=true のときのみ /api を認証必須にするガード。
// /api/auth/* と /api/health は常に素通し（ログイン・死活監視のため）。
const PUBLIC_PREFIXES = ["/auth/", "/health"];

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isAuthRequired()) return next();
  if (PUBLIC_PREFIXES.some((p) => req.path === p || req.path.startsWith(p))) return next();

  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  const userId = verifySessionToken(token);
  if (userId == null) {
    res.status(401).json({ error: "認証が必要です" });
    return;
  }
  try {
    // トークンが有効期間内でも、ユーザーが削除済みなら即座に無効化する
    // （退職者のアカウントを消したら30日セッションを待たず締め出すため）
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!rows[0]) {
      res.status(401).json({ error: "認証が必要です" });
      return;
    }
  } catch (err) {
    req.log.error({ err }, "Failed to verify user existence");
    res.status(500).json({ error: "認証確認に失敗しました" });
    return;
  }
  (req as Request & { userId?: number }).userId = userId;
  next();
}
