import { Router, type IRouter } from "express";
import { db, workTypesTable } from "@workspace/db";
import { asc, eq, max, sql } from "drizzle-orm";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isNaN(id) ? null : id;
}

router.get("/", async (req, res) => {
  try {
    const items = await db
      .select()
      .from(workTypesTable)
      .orderBy(asc(workTypesTable.code));
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Failed to list work types");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ message: "Invalid ID" });
    return;
  }
  try {
    const [item] = await db
      .select()
      .from(workTypesTable)
      .where(eq(workTypesTable.id, id));
    if (!item) {
      res.status(404).json({ message: "Work type not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to get work type");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, constructionType, notes } = req.body;
    if (!name) {
      res.status(400).json({ message: "name は必須です" });
      return;
    }
    const [{ maxCode }] = await db
      .select({ maxCode: max(sql<string>`NULLIF(REGEXP_REPLACE(${workTypesTable.code}, '[^0-9]', '', 'g'), '')::integer`) })
      .from(workTypesTable);
    const nextNumeric = (typeof maxCode === "number" ? maxCode : Number(maxCode) || 600) + 10;
    const code = String(nextNumeric).padStart(4, "0");
    const [item] = await db
      .insert(workTypesTable)
      .values({ code, name, constructionType: constructionType ?? "その他", notes: notes ?? null })
      .returning();
    res.status(201).json(item);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      res.status(409).json({ message: "同じコードの工種が既に存在します" });
      return;
    }
    req.log.error({ err }, "Failed to create work type");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ message: "Invalid ID" });
    return;
  }
  try {
    const { code, name, constructionType, notes } = req.body;
    const updates: Partial<{ code: string; name: string; constructionType: string; notes: string | null }> = {};
    if (code !== undefined) updates.code = code;
    if (name !== undefined) updates.name = name;
    if (constructionType !== undefined) updates.constructionType = constructionType;
    if (notes !== undefined) updates.notes = notes;
    const [item] = await db
      .update(workTypesTable)
      .set(updates)
      .where(eq(workTypesTable.id, id))
      .returning();
    if (!item) {
      res.status(404).json({ message: "Work type not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      res.status(409).json({ message: "同じコードの工種が既に存在します" });
      return;
    }
    req.log.error({ err }, "Failed to update work type");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ message: "Invalid ID" });
    return;
  }
  try {
    const [deleted] = await db
      .delete(workTypesTable)
      .where(eq(workTypesTable.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ message: "Work type not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete work type");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
