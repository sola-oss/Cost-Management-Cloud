import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, staffMembersTable, usersTable } from "@workspace/db";
import { getAccess } from "../lib/access";

import { isUniqueViolation } from "../lib/db-errors";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(staffMembersTable)
      .orderBy(asc(staffMembersTable.code));
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list staff members");
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * GET /api/staff-members/logins — 担当者ごとのログインの有無と権限
 * 担当者マスタで「この人はログインを持っているか」を見るため（作る・直すのはユーザー管理）。
 * 一般（現場）には出さない（他の人の権限まで見せる必要がないため）。
 */
router.get("/logins", async (req, res) => {
  if (getAccess(req).role === "field") return res.status(403).json({ message: "この操作をする権限がありません" });
  try {
    const rows = await db
      .select({ staffMemberId: usersTable.staffMemberId, role: usersTable.role })
      .from(usersTable);
    return res.json({ items: rows.filter((r) => r.staffMemberId != null) });
  } catch (err) {
    req.log.error({ err }, "Failed to list staff logins");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ message: "コードと名前は必須です" });
    const [row] = await db
      .insert(staffMembersTable)
      .values({ code: String(code).trim(), name: String(name).trim() })
      .returning();
    return res.status(201).json(row);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: "同じコードの担当者が既にあります" });
    }
    req.log.error({ err }, "Failed to create staff member");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { code, name, isActive } = req.body;
    if (!code || !name) return res.status(400).json({ message: "コードと名前は必須です" });
    const [row] = await db
      .update(staffMembersTable)
      .set({
        code: String(code).trim(),
        name: String(name).trim(),
        ...(typeof isActive === "boolean" ? { isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(staffMembersTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "担当者が見つかりません" });
    return res.json(row);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: "同じコードの担当者が既にあります" });
    }
    req.log.error({ err }, "Failed to update staff member");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(staffMembersTable).where(eq(staffMembersTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete staff member");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
