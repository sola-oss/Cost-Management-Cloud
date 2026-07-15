import { Router, type IRouter, type Request } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  createSessionToken,
  hashPassword,
  isAuthRequired,
  verifyPassword,
  verifySessionToken,
} from "../lib/auth";

const router: IRouter = Router();

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env["NODE_ENV"] === "production",
  maxAge: SESSION_MAX_AGE_MS,
  path: "/",
};

function currentUserId(req: Request): number | null {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  return verifySessionToken(token);
}

// 認証の有効状態と現在のユーザーを返す（フロントの起動時チェック用）
router.get("/status", async (req, res) => {
  try {
    const userId = currentUserId(req);
    let user = null;
    if (userId != null) {
      const rows = await db
        .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      user = rows[0] ?? null;
    }
    res.json({ authRequired: isAuthRequired(), user });
  } catch (err) {
    req.log.error({ err }, "Failed to get auth status");
    res.status(500).json({ error: "認証状態の取得に失敗しました" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: "メールアドレスとパスワードを入力してください" });
      return;
    }
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.trim().toLowerCase()));
    const user = rows[0];
    if (!user || !verifyPassword(password, user.passwordHash)) {
      // 存在有無を漏らさないよう同一メッセージにする
      res.status(401).json({ error: "メールアドレスまたはパスワードが正しくありません" });
      return;
    }
    res.cookie(SESSION_COOKIE, createSessionToken(user.id), cookieOptions);
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    req.log.error({ err }, "Failed to login");
    res.status(500).json({ error: "ログインに失敗しました" });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.post("/change-password", async (req, res) => {
  try {
    const userId = currentUserId(req);
    if (userId == null) {
      res.status(401).json({ error: "ログインが必要です" });
      return;
    }
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "現在のパスワードと新しいパスワードを入力してください" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "新しいパスワードは8文字以上にしてください" });
      return;
    }
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const user = rows[0];
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      res.status(401).json({ error: "現在のパスワードが正しくありません" });
      return;
    }
    await db
      .update(usersTable)
      .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to change password");
    res.status(500).json({ error: "パスワードの変更に失敗しました" });
  }
});

export default router;
