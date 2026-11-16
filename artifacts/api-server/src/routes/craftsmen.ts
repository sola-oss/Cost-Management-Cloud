import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, craftsmenTable, attendancesTable } from "@workspace/db";
import { isUniqueViolation } from "../lib/db-errors";

// ─── 職人マスタ（温品様の依頼 2026-11-13）────────────────────────────────────
// 出面に出す、ログインしない職人の一覧。担当者マスタとは別。

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await db.select().from(craftsmenTable).orderBy(asc(craftsmenTable.code));
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list craftsmen");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { code, name } = req.body ?? {};
    if (!code || !name) return res.status(400).json({ message: "コードと名前は必須です" });
    const [row] = await db
      .insert(craftsmenTable)
      .values({ code: String(code).trim(), name: String(name).trim() })
      .returning();
    return res.status(201).json(row);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) return res.status(409).json({ message: "同じコードの職人が既にあります" });
    req.log.error({ err }, "Failed to create craftsman");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { code, name, isActive } = req.body ?? {};
    if (!code || !name) return res.status(400).json({ message: "コードと名前は必須です" });
    const [row] = await db
      .update(craftsmenTable)
      .set({
        code: String(code).trim(),
        name: String(name).trim(),
        ...(typeof isActive === "boolean" ? { isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(craftsmenTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "職人が見つかりません" });
    return res.json(row);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) return res.status(409).json({ message: "同じコードの職人が既にあります" });
    req.log.error({ err }, "Failed to update craftsman");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// 出面が入っている職人は消さない（消すと出面と労務費まで消えるため）。「やめた」にしてもらう
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [used] = await db
      .select({ id: attendancesTable.id })
      .from(attendancesTable)
      .where(eq(attendancesTable.craftsmanId, id))
      .limit(1);
    if (used) {
      return res.status(409).json({ message: "出面が入っている職人は削除できません。状態を「やめた」にしてください。" });
    }
    await db.delete(craftsmenTable).where(eq(craftsmenTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete craftsman");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
