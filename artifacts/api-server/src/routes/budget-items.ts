import { Router, type IRouter } from "express";
import { eq, asc, and, desc, inArray } from "drizzle-orm";
import {
  db,
  budgetItemsTable,
  estimatesTable,
  estimateItemsTable,
  projectsTable,
  invoicesTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  vendorsTable,
} from "@workspace/db";

const router: IRouter = Router({ mergeParams: true });

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : (val as number) ?? 0;
}

function serializeItem(item: typeof budgetItemsTable.$inferSelect) {
  return {
    ...item,
    supplierCode: item.supplierCode ?? "",
    vendorId: item.vendorId ?? null,
    contractAmount: parseNumeric(item.contractAmount),
    initialBudget: parseNumeric(item.initialBudget),
    revisedBudget: parseNumeric(item.revisedBudget),
    originalBudgetAmount: parseNumeric(item.originalBudgetAmount),
    isOriginalLocked: item.isOriginalLocked ?? false,
    purchaseOrderId: item.purchaseOrderId ?? null,
    purchaseOrderItemId: item.purchaseOrderItemId ?? null,
  };
}

async function generatePONumber(dbOrTx: typeof db): Promise<string> {
  const today = new Date();
  const ymd =
    String(today.getFullYear()) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `PO-${ymd}-`;
  const all = await dbOrTx.select({ n: purchaseOrdersTable.orderNumber }).from(purchaseOrdersTable);
  const todayNums = all
    .map((r) => r.n)
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
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

router.post("/bulk-create-purchase-orders", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const projectId = parseInt(p.id);
    const { orderDate, groups } = req.body;

    if (!orderDate || !Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ message: "orderDate と groups は必須です" });
    }

    const allBudgetItemIds: number[] = groups.flatMap((g: { budgetItemIds?: number[] }) => g.budgetItemIds ?? []);
    if (allBudgetItemIds.length === 0) {
      return res.status(400).json({ message: "budgetItemIds が空です" });
    }

    // グループ間で重複する budgetItemId を検出
    const seen = new Set<number>();
    for (const id of allBudgetItemIds) {
      if (seen.has(id)) {
        return res.status(400).json({ message: `budgetItemId ${id} が複数のグループに含まれています` });
      }
      seen.add(id);
    }

    const result = await db.transaction(async (tx) => {
      const budgetItems = await tx
        .select()
        .from(budgetItemsTable)
        .where(inArray(budgetItemsTable.id, allBudgetItemIds));

      const invalidProject = budgetItems.find(bi => bi.projectId !== projectId);
      if (invalidProject) {
        throw Object.assign(new Error(`Budget item ${invalidProject.id} does not belong to project ${projectId}`), { statusCode: 400 });
      }

      const foundIds = new Set(budgetItems.map(bi => bi.id));
      const missingIds = allBudgetItemIds.filter(id => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw Object.assign(new Error(`実行予算明細が見つかりません: ${missingIds.join(",")}`), { statusCode: 404 });
      }

      const alreadyOrdered = budgetItems.filter(bi => bi.purchaseOrderId !== null);
      if (alreadyOrdered.length > 0) {
        const ids = alreadyOrdered.map(bi => bi.id).join(", ");
        throw Object.assign(new Error(`以下の実行予算明細は既に発注済みです（ID: ${ids}）`), { statusCode: 409 });
      }

      const createdPurchaseOrders: Array<{ id: number; orderNo: string; vendorId: number }> = [];

      for (const group of groups as Array<{ vendorId: number; budgetItemIds: number[]; deliveryDate?: string | null; notes?: string | null }>) {
        const { vendorId, budgetItemIds, deliveryDate, notes } = group;

        if (!vendorId || !Array.isArray(budgetItemIds) || budgetItemIds.length === 0) {
          throw Object.assign(new Error("各グループに vendorId と budgetItemIds は必須です"), { statusCode: 400 });
        }

        const [vendor] = await tx.select().from(vendorsTable).where(eq(vendorsTable.id, vendorId));
        if (!vendor) {
          throw Object.assign(new Error(`仕入先 ID ${vendorId} が見つかりません`), { statusCode: 404 });
        }

        const groupItems = budgetItems.filter(bi => budgetItemIds.includes(bi.id));

        const subtotal = groupItems.reduce((s, bi) => s + parseNumeric(bi.revisedBudget), 0);
        const taxAmount = Math.floor(subtotal * 10 / 100);
        const totalAmount = subtotal + taxAmount;

        const orderNumber = await generatePONumber(tx as unknown as typeof db);

        const [order] = await tx
          .insert(purchaseOrdersTable)
          .values({
            orderNumber,
            projectId,
            vendorId,
            orderDate,
            expectedDeliveryDate: deliveryDate ?? null,
            status: "draft",
            subtotal: String(subtotal),
            taxAmount: String(taxAmount),
            totalAmount: String(totalAmount),
            notes: notes ?? null,
          })
          .returning();

        const insertedItems = await tx
          .insert(purchaseOrderItemsTable)
          .values(
            groupItems.map((bi, idx) => ({
              purchaseOrderId: order.id,
              lineNumber: idx + 1,
              category: "subcontract" as const,
              description: bi.workTypeName,
              specification: null,
              quantity: "1",
              unit: "式",
              unitPrice: String(parseNumeric(bi.revisedBudget)),
              amount: String(parseNumeric(bi.revisedBudget)),
              taxRate: "10",
              workTypeId: null,
            }))
          )
          .returning();

        for (let i = 0; i < groupItems.length; i++) {
          const bi = groupItems[i];
          const poi = insertedItems[i];
          await tx
            .update(budgetItemsTable)
            .set({
              purchaseOrderId: order.id,
              purchaseOrderItemId: poi.id,
              vendorId,
              updatedAt: new Date(),
            })
            .where(eq(budgetItemsTable.id, bi.id));
        }

        createdPurchaseOrders.push({
          id: order.id,
          orderNo: order.orderNumber,
          vendorId: order.vendorId,
        });
      }

      return { createdPurchaseOrders };
    });

    return res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 409) {
      return res.status(409).json({ message: e.message });
    }
    if (e.statusCode === 400) {
      return res.status(400).json({ message: e.message });
    }
    if (e.statusCode === 404) {
      return res.status(404).json({ message: e.message });
    }
    req.log.error({ err }, "Failed to bulk create purchase orders");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const projectId = parseInt(p.id);
    const { workTypeCode, workTypeName, supplierCode, supplierName, vendorId, contractAmount, initialBudget, revisedBudget, sortOrder } = req.body;

    const [item] = await db
      .insert(budgetItemsTable)
      .values({
        projectId,
        workTypeCode,
        workTypeName,
        supplierCode: supplierCode ?? "",
        supplierName: supplierName ?? "",
        vendorId: vendorId ? parseInt(vendorId) : null,
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
    const { workTypeCode, workTypeName, supplierCode, supplierName, vendorId, contractAmount, initialBudget, revisedBudget, sortOrder } = req.body;

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
    if ("vendorId" in req.body) updateData.vendorId = vendorId != null ? parseInt(vendorId) : null;
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
