import { Router, type IRouter } from "express";
import { eq, asc, and } from "drizzle-orm";
import { db, budgetItemsTable } from "@workspace/db";

const router: IRouter = Router({ mergeParams: true });

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : (val as number) ?? 0;
}

function serializeItem(item: typeof budgetItemsTable.$inferSelect) {
  return {
    ...item,
    supplierCode: item.supplierCode ?? "",
    contractAmount: parseNumeric(item.contractAmount),
    initialBudget: parseNumeric(item.initialBudget),
    revisedBudget: parseNumeric(item.revisedBudget),
  };
}

router.get("/", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const items = await db
      .select()
      .from(budgetItemsTable)
      .where(eq(budgetItemsTable.projectId, projectId))
      .orderBy(asc(budgetItemsTable.sortOrder), asc(budgetItemsTable.id));

    const totalContractAmount = items.reduce((s, i) => s + parseNumeric(i.contractAmount), 0);
    const totalInitialBudget = items.reduce((s, i) => s + parseNumeric(i.initialBudget), 0);
    const totalRevisedBudget = items.reduce((s, i) => s + parseNumeric(i.revisedBudget), 0);

    res.json({
      items: items.map(serializeItem),
      totalContractAmount,
      totalInitialBudget,
      totalRevisedBudget,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list budget items");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { workTypeCode, workTypeName, supplierCode, supplierName, contractAmount, initialBudget, revisedBudget, sortOrder } = req.body;

    const [item] = await db
      .insert(budgetItemsTable)
      .values({
        projectId,
        workTypeCode,
        workTypeName,
        supplierCode: supplierCode ?? "",
        supplierName: supplierName ?? "",
        contractAmount: String(contractAmount ?? 0),
        initialBudget: String(initialBudget ?? 0),
        revisedBudget: String(revisedBudget ?? 0),
        sortOrder: sortOrder ?? 0,
      })
      .returning();

    res.status(201).json(serializeItem(item));
  } catch (err) {
    req.log.error({ err }, "Failed to create budget item");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:itemId", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);
    const { workTypeCode, workTypeName, supplierCode, supplierName, contractAmount, initialBudget, revisedBudget, sortOrder } = req.body;

    const updateData: Partial<typeof budgetItemsTable.$inferInsert> = {};
    if (workTypeCode !== undefined) updateData.workTypeCode = workTypeCode;
    if (workTypeName !== undefined) updateData.workTypeName = workTypeName;
    if (supplierCode !== undefined) updateData.supplierCode = supplierCode;
    if (supplierName !== undefined) updateData.supplierName = supplierName;
    if (contractAmount !== undefined) updateData.contractAmount = String(contractAmount);
    if (initialBudget !== undefined) updateData.initialBudget = String(initialBudget);
    if (revisedBudget !== undefined) updateData.revisedBudget = String(revisedBudget);
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(budgetItemsTable)
      .set(updateData)
      .where(and(eq(budgetItemsTable.id, itemId), eq(budgetItemsTable.projectId, projectId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ message: "予算明細が見つかりません" });
    }

    res.json(serializeItem(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update budget item");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:itemId", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);

    const [existing] = await db
      .select()
      .from(budgetItemsTable)
      .where(eq(budgetItemsTable.id, itemId));

    if (!existing || existing.projectId !== projectId) {
      return res.status(404).json({ message: "予算明細が見つかりません" });
    }

    await db.delete(budgetItemsTable).where(eq(budgetItemsTable.id, itemId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete budget item");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
