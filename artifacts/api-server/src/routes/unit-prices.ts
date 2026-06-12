import { Router, type IRouter } from "express";
import { db, unitPricesTable, vendorsTable, workTypesTable } from "@workspace/db";
import { asc, eq, and, ilike, sql } from "drizzle-orm";

const router: IRouter = Router();

/** GET /api/unit-prices?vendorId=&workTypeId=&q= */
router.get("/", async (req, res) => {
  try {
    const conditions = [];
    if (req.query.vendorId) {
      conditions.push(eq(unitPricesTable.vendorId, Number(req.query.vendorId)));
    }
    if (req.query.workTypeId) {
      conditions.push(eq(unitPricesTable.workTypeId, Number(req.query.workTypeId)));
    }
    if (req.query.q) {
      conditions.push(ilike(unitPricesTable.itemName, `%${req.query.q}%`));
    }

    const rows = await db
      .select({
        unitPrice: unitPricesTable,
        vendorName: vendorsTable.name,
        workTypeName: workTypesTable.name,
        workTypeCode: workTypesTable.code,
      })
      .from(unitPricesTable)
      .leftJoin(vendorsTable, eq(unitPricesTable.vendorId, vendorsTable.id))
      .leftJoin(workTypesTable, eq(unitPricesTable.workTypeId, workTypesTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(vendorsTable.name), asc(unitPricesTable.itemName));

    res.json({
      items: rows.map((r) => ({
        ...r.unitPrice,
        vendorName: r.vendorName ?? null,
        workTypeName: r.workTypeName ?? null,
        workTypeCode: r.workTypeCode ?? null,
      })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list unit prices");
    res.status(500).json({ message: "Internal server error" });
  }
});

/** GET /api/unit-prices/:id */
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [row] = await db
      .select({
        unitPrice: unitPricesTable,
        vendorName: vendorsTable.name,
        workTypeName: workTypesTable.name,
        workTypeCode: workTypesTable.code,
      })
      .from(unitPricesTable)
      .leftJoin(vendorsTable, eq(unitPricesTable.vendorId, vendorsTable.id))
      .leftJoin(workTypesTable, eq(unitPricesTable.workTypeId, workTypesTable.id))
      .where(eq(unitPricesTable.id, id));

    if (!row) return res.status(404).json({ message: "単価が見つかりません" });

    return res.json({
      ...row.unitPrice,
      vendorName: row.vendorName ?? null,
      workTypeName: row.workTypeName ?? null,
      workTypeCode: row.workTypeCode ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get unit price");
    return res.status(500).json({ message: "Internal server error" });
  }
});

/** POST /api/unit-prices */
router.post("/", async (req, res) => {
  try {
    const { vendorId, workTypeId, itemName, unit, unitPrice, notes } = req.body;
    if (!vendorId || !itemName) {
      return res.status(400).json({ message: "vendorId と itemName は必須です" });
    }
    const [row] = await db
      .insert(unitPricesTable)
      .values({
        vendorId: Number(vendorId),
        workTypeId: workTypeId ? Number(workTypeId) : null,
        itemName,
        unit: unit ?? "式",
        unitPrice: unitPrice != null ? String(unitPrice) : "0",
        notes: notes ?? null,
      })
      .returning();
    return res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create unit price");
    return res.status(500).json({ message: "Internal server error" });
  }
});

/** PATCH /api/unit-prices/:id */
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const { vendorId, workTypeId, itemName, unit, unitPrice, notes } = req.body;
    const [row] = await db
      .update(unitPricesTable)
      .set({
        ...(vendorId !== undefined && { vendorId: Number(vendorId) }),
        ...(workTypeId !== undefined && { workTypeId: workTypeId ? Number(workTypeId) : null }),
        ...(itemName !== undefined && { itemName }),
        ...(unit !== undefined && { unit }),
        ...(unitPrice !== undefined && { unitPrice: String(unitPrice) }),
        ...(notes !== undefined && { notes: notes ?? null }),
        updatedAt: new Date(),
      })
      .where(eq(unitPricesTable.id, id))
      .returning();

    if (!row) return res.status(404).json({ message: "単価が見つかりません" });
    return res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update unit price");
    return res.status(500).json({ message: "Internal server error" });
  }
});

/** DELETE /api/unit-prices/:id */
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    await db.delete(unitPricesTable).where(eq(unitPricesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete unit price");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
