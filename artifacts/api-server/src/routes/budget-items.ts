import { Router, type IRouter } from "express";
import { eq, asc, and, desc } from "drizzle-orm";
import { db, budgetItemsTable, estimatesTable, estimateItemsTable, projectsTable, invoicesTable } from "@workspace/db";

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
    originalBudgetAmount: parseNumeric(item.originalBudgetAmount),
    isOriginalLocked: item.isOriginalLocked ?? false,
  };
}

router.get("/", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const projectId = parseInt(p.id);
    const items = await db
      .select()
      .from(budgetItemsTable)
      .where(eq(budgetItemsTable.projectId, projectId))
      .orderBy(asc(budgetItemsTable.sortOrder), asc(budgetItemsTable.id));

    const totalContractAmount = items.reduce((s, i) => s + parseNumeric(i.contractAmount), 0);
    const totalInitialBudget = items.reduce((s, i) => s + parseNumeric(i.initialBudget), 0);
    const totalRevisedBudget = items.reduce((s, i) => s + parseNumeric(i.revisedBudget), 0);

    // billedToDate here is the total of ALL invoices for this project.
    // This is intentional: this endpoint is used in the invoice create flow (no current
    // invoice ID exists yet), so all existing project invoices are "prior" billing.
    // When editing an existing invoice, use GET /api/invoices/:id which applies
    // proper date-based filtering (invoiceDate < current) to exclude later invoices.
    const invoices = await db
      .select({ totalAmount: invoicesTable.totalAmount })
      .from(invoicesTable)
      .where(eq(invoicesTable.projectId, projectId));
    const billedToDate = invoices.reduce((s, inv) => s + parseNumeric(inv.totalAmount), 0);

    res.json({
      items: items.map(serializeItem),
      totalContractAmount,
      totalInitialBudget,
      totalRevisedBudget,
      billedToDate,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list budget items");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/import-from-estimate", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const projectId = parseInt(p.id);
    const dryRun = req.query.dryRun === "true";

    const existingItems = await db
      .select({ id: budgetItemsTable.id })
      .from(budgetItemsTable)
      .where(eq(budgetItemsTable.projectId, projectId))
      .limit(1);

    if (existingItems.length > 0) {
      return res.status(409).json({ message: "当初予算は登録済みです" });
    }

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));

    if (!project) {
      return res.status(404).json({ message: "工事が見つかりません" });
    }

    const estimates = await db
      .select()
      .from(estimatesTable)
      .where(eq(estimatesTable.projectId, projectId))
      .orderBy(desc(estimatesTable.createdAt));

    if (estimates.length === 0) {
      return res.status(404).json({ message: "この工事に紐付いた見積書が見つかりません" });
    }

    const preferred = project.estimateNumber
      ? estimates.find(e => e.estimateNumber === project.estimateNumber)
      : undefined;
    const estimate = preferred ?? estimates[0];

    const estimateItems = await db
      .select()
      .from(estimateItemsTable)
      .where(
        and(
          eq(estimateItemsTable.estimateId, estimate.id),
          eq(estimateItemsTable.rowType, "normal")
        )
      )
      .orderBy(asc(estimateItemsTable.rowIndex));

    const normalItems = estimateItems.filter(i => parseNumeric(i.amount) > 0);

    if (normalItems.length === 0) {
      return res.status(404).json({ message: "取込み対象の明細が見つかりません（金額 > 0 の通常行が必要です）" });
    }

    if (dryRun) {
      return res.status(200).json({
        estimateNumber: estimate.estimateNumber,
        importableCount: normalItems.length,
      });
    }

    const inserted = await db
      .insert(budgetItemsTable)
      .values(
        normalItems.map((item, idx) => ({
          projectId,
          workTypeCode: item.workType || "—",
          workTypeName: item.itemName || "—",
          supplierCode: "",
          supplierName: "",
          contractAmount: "0",
          initialBudget: String(item.amount),
          revisedBudget: String(item.amount),
          sortOrder: idx,
          isOriginalLocked: true,
          originalBudgetAmount: String(item.amount),
        }))
      )
      .returning();

    return res.status(201).json({
      estimateNumber: estimate.estimateNumber,
      importedCount: inserted.length,
      items: inserted.map(serializeItem),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to import budget items from estimate");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const projectId = parseInt(p.id);
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
    const p = req.params as Record<string, string>;
    const projectId = parseInt(p.id);
    const itemId = parseInt(p.itemId);
    const { workTypeCode, workTypeName, supplierCode, supplierName, contractAmount, initialBudget, revisedBudget, sortOrder } = req.body;

    const [existing] = await db
      .select()
      .from(budgetItemsTable)
      .where(and(eq(budgetItemsTable.id, itemId), eq(budgetItemsTable.projectId, projectId)));

    if (!existing) {
      return res.status(404).json({ message: "予算明細が見つかりません" });
    }

    if (existing.isOriginalLocked && initialBudget !== undefined) {
      return res.status(422).json({ message: "当初予算はロックされています。変更できません。" });
    }

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

    return res.json(serializeItem(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update budget item");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:itemId", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const projectId = parseInt(p.id);
    const itemId = parseInt(p.itemId);

    const [existing] = await db
      .select()
      .from(budgetItemsTable)
      .where(eq(budgetItemsTable.id, itemId));

    if (!existing || existing.projectId !== projectId) {
      return res.status(404).json({ message: "予算明細が見つかりません" });
    }

    await db.delete(budgetItemsTable).where(eq(budgetItemsTable.id, itemId));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete budget item");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
