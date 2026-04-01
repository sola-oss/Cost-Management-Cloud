import { Router, type IRouter } from "express";
import { db, workTypesTable } from "@workspace/db";
import { asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const items = await db
      .select({ id: workTypesTable.id, code: workTypesTable.code, name: workTypesTable.name })
      .from(workTypesTable)
      .orderBy(asc(workTypesTable.code));
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Failed to list work types");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
