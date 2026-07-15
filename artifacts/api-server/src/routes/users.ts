import { Router, type IRouter, type Request } from "express";
import { eq, asc } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { SESSION_COOKIE, hashPassword, verifySessionToken } from "../lib/auth";

import { isUniqueViolation } from "../lib/db-errors";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function currentUserId(req: Request): number | null {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  return verifySessionToken(token);
}

const publicColumns = {
  id: usersTable.id,
  email: usersTable.email,
  name: usersTable.name,
  role: usersTable.role,
  createdAt: usersTable.createdAt,
};

router.get("/", async (req, res) => {
  try {
    const rows = await db.select(publicColumns).from(usersTable).orderBy(asc(usersTable.id));
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list users");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { email, name, password } = req.body as { email?: string; name?: string; password?: string };
    if (!email || !name || !password) {
      return res.status(400).json({ message: "メールアドレス・名前・初期パスワードは必須です" });
    }
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      return res.status(400).json({ message: "メールアドレスの形式が正しくありません" });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "パスワードは8文字以上にしてください" });
    }
    const [row] = await db
      .insert(usersTable)
      .values({ email: normalized, name: name.trim(), passwordHash: hashPassword(password), role: "admin" })
      .returning(publicColumns);
    return res.status(201).json(row);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: "同じメールアドレスのユーザーが既にあります" });
    }
    req.log.error({ err }, "Failed to create user");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { email, name, password } = req.body as { email?: string; name?: string; password?: string };
    if (!email || !name) {
      return res.status(400).json({ message: "メールアドレスと名前は必須です" });
    }
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      return res.status(400).json({ message: "メールアドレスの形式が正しくありません" });
    }
    const update: { email: string; name: string; updatedAt: Date; passwordHash?: string } = {
      email: normalized,
      name: name.trim(),
      updatedAt: new Date(),
    };
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ message: "パスワードは8文字以上にしてください" });
      }
      update.passwordHash = hashPassword(password);
    }
    const [row] = await db.update(usersTable).set(update).where(eq(usersTable.id, id)).returning(publicColumns);
    if (!row) return res.status(404).json({ message: "ユーザーが見つかりません" });
    return res.json(row);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: "同じメールアドレスのユーザーが既にあります" });
    }
    req.log.error({ err }, "Failed to update user");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // 自分自身の削除と最後の1人の削除は禁止（全員ログイン不能になる事故防止）
    if (currentUserId(req) === id) {
      return res.status(400).json({ message: "自分自身のアカウントは削除できません" });
    }
    const all = await db.select({ id: usersTable.id }).from(usersTable);
    if (all.length <= 1) {
      return res.status(400).json({ message: "最後のユーザーは削除できません" });
    }
    await db.delete(usersTable).where(eq(usersTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete user");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
