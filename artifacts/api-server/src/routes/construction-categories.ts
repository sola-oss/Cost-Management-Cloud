import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, constructionCategoriesTable } from "@workspace/db";

import { isUniqueViolation } from "../lib/db-errors";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(constructionCategoriesTable)
      .orderBy(asc(constructionCategoriesTable.code));
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list construction categories");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ message: "コードと名称は必須です" });
    const [row] = await db
      .insert(constructionCategoriesTable)
      .values({ code: String(code).trim(), name: String(name).trim() })
      .returning();
    return res.status(201).json(row);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: "同じコードの工事分類が既にあります" });
    }
    req.log.error({ err }, "Failed to create construction category");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ message: "コードと名称は必須です" });
    const [row] = await db
      .update(constructionCategoriesTable)
      .set({ code: String(code).trim(), name: String(name).trim(), updatedAt: new Date() })
      .where(eq(constructionCategoriesTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "工事分類が見つかりません" });
    return res.json(row);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: "同じコードの工事分類が既にあります" });
    }
    req.log.error({ err }, "Failed to update construction category");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(constructionCategoriesTable).where(eq(constructionCategoriesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete construction category");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
