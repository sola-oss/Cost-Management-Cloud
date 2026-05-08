import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, vendorGroupsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(vendorGroupsTable)
      .orderBy(vendorGroupsTable.name);
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list vendor groups");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, notes } = req.body;
    if (!name) return res.status(400).json({ message: "name は必須です" });
    const [row] = await db
      .insert(vendorGroupsTable)
      .values({ name, notes: notes ?? null })
      .returning();
    return res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create vendor group");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, notes } = req.body;
    const [row] = await db
      .update(vendorGroupsTable)
      .set({ name, notes: notes ?? null, updatedAt: new Date() })
      .where(eq(vendorGroupsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "グループが見つかりません" });
    return res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update vendor group");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(vendorGroupsTable).where(eq(vendorGroupsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete vendor group");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
