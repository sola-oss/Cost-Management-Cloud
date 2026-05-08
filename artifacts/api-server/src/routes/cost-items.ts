import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, costItemsTable, projectsTable } from "@workspace/db";

const router: IRouter = Router();

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : (val as number) ?? 0;
}

router.get("/", async (req, res) => {
  try {
    const { projectId, category, limit: limitStr } = req.query as Record<string, string>;
    const limitNum = limitStr ? Math.min(parseInt(limitStr), 500) : 100;

    if (projectId) {
      // プロジェクト別（既存動作）
      const conditions = [eq(costItemsTable.projectId, parseInt(projectId))];
      if (category) conditions.push(eq(costItemsTable.category, category as any));

      const items = await db.select().from(costItemsTable)
        .where(and(...conditions))
        .orderBy(desc(costItemsTable.incurredDate))
        .limit(limitNum);

      const totalAmount = items.reduce((sum, ci) => sum + parseNumeric(ci.amount), 0);
      return res.json({
        items: items.map(ci => ({
          ...ci,
          amount: parseNumeric(ci.amount),
          quantity: ci.quantity ? parseNumeric(ci.quantity) : null,
          unitPrice: ci.unitPrice ? parseNumeric(ci.unitPrice) : null,
        })),
        total: items.length,
        totalAmount,
      });
    }

    // 全工事の最近の仕入一覧（仕入入力ページ用）
    const rows = await db
      .select({
        costItem: costItemsTable,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
        clientName: projectsTable.clientName,
      })
      .from(costItemsTable)
      .innerJoin(projectsTable, eq(costItemsTable.projectId, projectsTable.id))
      .orderBy(desc(costItemsTable.incurredDate))
      .limit(limitNum);

    const totalAmount = rows.reduce((sum, r) => sum + parseNumeric(r.costItem.amount), 0);
    return res.json({
      items: rows.map(r => ({
        ...r.costItem,
        amount: parseNumeric(r.costItem.amount),
        quantity: r.costItem.quantity ? parseNumeric(r.costItem.quantity) : null,
        unitPrice: r.costItem.unitPrice ? parseNumeric(r.costItem.unitPrice) : null,
        projectCode: r.projectCode,
        projectName: r.projectName,
        clientName: r.clientName,
      })),
      total: rows.length,
      totalAmount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list cost items");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { projectId, category, description, vendor, quantity, unit, unitPrice, amount, incurredDate, invoiceNumber, notes } = req.body;

    const [item] = await db.insert(costItemsTable).values({
      projectId,
      category,
      description,
      vendor: vendor ?? null,
      quantity: quantity != null ? String(quantity) : null,
      unit: unit ?? null,
      unitPrice: unitPrice != null ? String(unitPrice) : null,
      amount: String(amount),
      incurredDate,
      invoiceNumber: invoiceNumber ?? null,
      notes: notes ?? null,
    }).returning();

    res.status(201).json({
      ...item,
      amount: parseNumeric(item.amount),
      quantity: item.quantity ? parseNumeric(item.quantity) : null,
      unitPrice: item.unitPrice ? parseNumeric(item.unitPrice) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create cost item");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { category, description, vendor, quantity, unit, unitPrice, amount, incurredDate, invoiceNumber, notes } = req.body;

    const updateData: Partial<typeof costItemsTable.$inferInsert> = {};
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (vendor !== undefined) updateData.vendor = vendor;
    if (quantity !== undefined) updateData.quantity = quantity != null ? String(quantity) : null;
    if (unit !== undefined) updateData.unit = unit;
    if (unitPrice !== undefined) updateData.unitPrice = unitPrice != null ? String(unitPrice) : null;
    if (amount !== undefined) updateData.amount = String(amount);
    if (incurredDate !== undefined) updateData.incurredDate = incurredDate;
    if (invoiceNumber !== undefined) updateData.invoiceNumber = invoiceNumber;
    if (notes !== undefined) updateData.notes = notes;
    updateData.updatedAt = new Date();

    const [updated] = await db.update(costItemsTable).set(updateData).where(eq(costItemsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "原価項目が見つかりません" });

    return res.json({
      ...updated,
      amount: parseNumeric(updated.amount),
      quantity: updated.quantity ? parseNumeric(updated.quantity) : null,
      unitPrice: updated.unitPrice ? parseNumeric(updated.unitPrice) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update cost item");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(costItemsTable).where(eq(costItemsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete cost item");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
