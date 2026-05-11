import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, costItemsTable, projectsTable, purchaseInvoiceItemsTable } from "@workspace/db";

const router: IRouter = Router();

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : (val as number) ?? 0;
}

router.get("/", async (req, res) => {
  try {
    const { projectId, category, limit: limitStr } = req.query as Record<string, string>;
    const limitNum = limitStr ? Math.min(parseInt(limitStr), 500) : 100;

    if (projectId) {
      const conditions = [eq(costItemsTable.projectId, parseInt(projectId))];
      if (category) conditions.push(eq(costItemsTable.category, category as any));

      const rows = await db
        .select({
          item: costItemsTable,
          purchaseInvoiceId: purchaseInvoiceItemsTable.purchaseInvoiceId,
        })
        .from(costItemsTable)
        .leftJoin(
          purchaseInvoiceItemsTable,
          eq(costItemsTable.sourceId, purchaseInvoiceItemsTable.id)
        )
        .where(and(...conditions))
        .orderBy(desc(costItemsTable.incurredDate))
        .limit(limitNum);

      const items = rows.map((r) => ({
        ...r.item,
        amount: parseNumeric(r.item.amount),
        quantity: r.item.quantity ? parseNumeric(r.item.quantity) : null,
        unitPrice: r.item.unitPrice ? parseNumeric(r.item.unitPrice) : null,
        purchaseInvoiceId:
          r.item.sourceType === "purchase_invoice" ? (r.purchaseInvoiceId ?? null) : null,
      }));

      const totalAmount = items.reduce((sum, ci) => sum + ci.amount, 0);
      return res.json({ items, total: items.length, totalAmount });
    }

    // 全工事の最近の仕入一覧（仕入入力ページ用）
    const rows = await db
      .select({
        costItem: costItemsTable,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
        clientName: projectsTable.clientName,
        purchaseInvoiceId: purchaseInvoiceItemsTable.purchaseInvoiceId,
      })
      .from(costItemsTable)
      .innerJoin(projectsTable, eq(costItemsTable.projectId, projectsTable.id))
      .leftJoin(
        purchaseInvoiceItemsTable,
        eq(costItemsTable.sourceId, purchaseInvoiceItemsTable.id)
      )
      .orderBy(desc(costItemsTable.incurredDate))
      .limit(limitNum);

    const totalAmount = rows.reduce((sum, r) => sum + parseNumeric(r.costItem.amount), 0);
    return res.json({
      items: rows.map((r) => ({
        ...r.costItem,
        amount: parseNumeric(r.costItem.amount),
        quantity: r.costItem.quantity ? parseNumeric(r.costItem.quantity) : null,
        unitPrice: r.costItem.unitPrice ? parseNumeric(r.costItem.unitPrice) : null,
        projectCode: r.projectCode,
        projectName: r.projectName,
        clientName: r.clientName,
        purchaseInvoiceId:
          r.costItem.sourceType === "purchase_invoice" ? (r.purchaseInvoiceId ?? null) : null,
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
      purchaseInvoiceId: null,
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
      purchaseInvoiceId: null,
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

// GET /api/cost-items/:id/source-voucher
// 仕入伝票由来の原価項目から親伝票 ID を逆引きする
router.get("/:id/source-voucher", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [ci] = await db
      .select({ sourceType: costItemsTable.sourceType, sourceId: costItemsTable.sourceId })
      .from(costItemsTable)
      .where(eq(costItemsTable.id, id));

    if (!ci) return res.status(404).json({ message: "原価項目が見つかりません" });
    if (ci.sourceType !== "purchase_invoice" || !ci.sourceId) {
      return res.status(400).json({ message: "仕入伝票由来の項目ではありません" });
    }

    const [invItem] = await db
      .select({ purchaseInvoiceId: purchaseInvoiceItemsTable.purchaseInvoiceId })
      .from(purchaseInvoiceItemsTable)
      .where(eq(purchaseInvoiceItemsTable.id, ci.sourceId));

    if (!invItem) return res.status(404).json({ message: "仕入伝票明細が見つかりません" });

    return res.json({ invoiceId: invItem.purchaseInvoiceId });
  } catch (err) {
    req.log.error({ err }, "Failed to get source voucher");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
