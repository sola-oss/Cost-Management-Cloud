import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, isAuthRequired, verifySessionToken } from "../lib/auth";

// AUTH_REQUIRED=true のときのみ /api を認証必須にするガード。
// /api/auth/* と /api/health は常に素通し（ログイン・死活監視のため）。
const PUBLIC_PREFIXES = ["/auth/", "/health"];

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isAuthRequired()) return next();
  if (PUBLIC_PREFIXES.some((p) => req.path === p || req.path.startsWith(p))) return next();

  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  const userId = verifySessionToken(token);
  if (userId == null) {
    res.status(401).json({ error: "認証が必要です" });
    return;
  }
  (req as Request & { userId?: number }).userId = userId;
  next();
}
