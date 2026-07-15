import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, staffMembersTable } from "@workspace/db";

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
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23505") {
      return res.status(409).json({ message: "同じコードの担当者が既にあります" });
    }
    req.log.error({ err }, "Failed to create staff member");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ message: "コードと名前は必須です" });
    const [row] = await db
      .update(staffMembersTable)
      .set({ code: String(code).trim(), name: String(name).trim(), updatedAt: new Date() })
      .where(eq(staffMembersTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "担当者が見つかりません" });
    return res.json(row);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23505") {
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
