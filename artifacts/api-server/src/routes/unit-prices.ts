import { Router, type IRouter } from "express";
import { db, unitPricesTable, vendorsTable, workTypesTable } from "@workspace/db";
import { asc, eq, and, ilike, isNull, sql } from "drizzle-orm";

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

/**
 * POST /api/unit-prices
 *
 * 単価マスタが重複で濁らないよう、同じ「仕入先 × 工種 × 品名」の既存行を探して分岐する：
 * - 既存なし        → 新規登録（201, status:"created"）
 * - 既存あり・同単価 → 何もしない（200, status:"unchanged"）＝重複を作らない
 * - 既存あり・別単価 → forceUpdate=true なら更新（200, status:"updated"）、
 *                      さもなければ確認を促す（409, status:"conflict", existing）
 */
router.post("/", async (req, res) => {
  try {
    const { vendorId, workTypeId, itemName, unit, unitPrice, notes, forceUpdate } = req.body;
    if (!vendorId || !itemName) {
      return res.status(400).json({ message: "vendorId と itemName は必須です" });
    }
    const vId = Number(vendorId);
    const wId = workTypeId ? Number(workTypeId) : null;
    const name = String(itemName).trim();
    const priceStr = unitPrice != null ? String(unitPrice) : "0";

    // 同一キー（仕入先 × 工種 × 品名）の既存を探す（工種未設定同士も同一とみなす）
    const [existing] = await db
      .select()
      .from(unitPricesTable)
      .where(
        and(
          eq(unitPricesTable.vendorId, vId),
          wId === null ? isNull(unitPricesTable.workTypeId) : eq(unitPricesTable.workTypeId, wId),
          eq(unitPricesTable.itemName, name),
        ),
      );

    if (existing) {
      const samePrice = Number(existing.unitPrice) === Number(priceStr);
      if (samePrice) {
        return res.status(200).json({ status: "unchanged", row: existing });
      }
      if (!forceUpdate) {
        return res.status(409).json({
          status: "conflict",
          message: "同じ仕入先・工種・品名の単価が既に登録されています。",
          existing,
        });
      }
      const [updated] = await db
        .update(unitPricesTable)
        .set({
          unit: unit ?? existing.unit,
          unitPrice: priceStr,
          ...(notes !== undefined && { notes: notes ?? null }),
          updatedAt: new Date(),
        })
        .where(eq(unitPricesTable.id, existing.id))
        .returning();
      return res.status(200).json({ status: "updated", row: updated });
    }

    const [row] = await db
      .insert(unitPricesTable)
      .values({
        vendorId: vId,
        workTypeId: wId,
        itemName: name,
        unit: unit ?? "式",
        unitPrice: priceStr,
        notes: notes ?? null,
      })
      .returning();
    return res.status(201).json({ status: "created", row });
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
