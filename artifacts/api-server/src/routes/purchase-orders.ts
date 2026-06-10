import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  purchaseInvoicesTable,
  vendorsTable,
  projectsTable,
  budgetItemsTable,
} from "@workspace/db";
import type { PurchaseOrderStatus } from "@workspace/db";

const router: IRouter = Router();

function parseN(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) || 0 : ((v as number) ?? 0);
}

function formatOrder(o: typeof purchaseOrdersTable.$inferSelect) {
  return {
    ...o,
    subtotal: parseN(o.subtotal),
    taxAmount: parseN(o.taxAmount),
    totalAmount: parseN(o.totalAmount),
  };
}

function formatItem(i: typeof purchaseOrderItemsTable.$inferSelect) {
  return {
    ...i,
    quantity: parseN(i.quantity),
    unitPrice: parseN(i.unitPrice),
    amount: parseN(i.amount),
    taxRate: parseN(i.taxRate),
    deliveredQuantity: parseN(i.deliveredQuantity),
  };
}

async function generateOrderNumber(): Promise<string> {
  const today = new Date();
  const ymd =
    String(today.getFullYear()) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `PO-${ymd}-`;
  const all = await db
    .select({ n: purchaseOrdersTable.orderNumber })
    .from(purchaseOrdersTable);
  const todayNums = all
    .map((r) => r.n)
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

interface ItemInput {
  category: string;
  description: string;
  specification?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  taxRate?: number;
  workTypeId?: number | null;
  lineNumber?: number;
}

function calcTotals(items: ItemInput[]): { subtotal: number; taxAmount: number; totalAmount: number } {
  const subtotal = items.reduce((s, i) => s + (i.amount || 0), 0);
  const taxAmount = items.reduce(
    (s, i) => s + Math.floor((i.amount || 0) * (i.taxRate ?? 10) / 100),
    0
  );
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

// GET /api/purchase-orders/available-for-invoice
// NOTE: must be declared BEFORE /:id to avoid route conflict
router.get("/available-for-invoice", async (req, res) => {
  try {
    const { projectId, vendorId } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [
      inArray(purchaseOrdersTable.status, ["ordered", "partial"]) as unknown as ReturnType<typeof eq>,
    ];
    if (projectId) conditions.push(eq(purchaseOrdersTable.projectId, parseInt(projectId)));
    if (vendorId) conditions.push(eq(purchaseOrdersTable.vendorId, parseInt(vendorId)));

    const rows = await db
      .select({
        order: purchaseOrdersTable,
        vendorName: vendorsTable.name,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
      })
      .from(purchaseOrdersTable)
      .leftJoin(vendorsTable, eq(purchaseOrdersTable.vendorId, vendorsTable.id))
      .leftJoin(projectsTable, eq(purchaseOrdersTable.projectId, projectsTable.id))
      .where(and(...conditions))
      .orderBy(desc(purchaseOrdersTable.orderDate));

    const ordersWithItems = await Promise.all(
      rows.map(async (r) => {
        const items = await db
          .select()
          .from(purchaseOrderItemsTable)
          .where(eq(purchaseOrderItemsTable.purchaseOrderId, r.order.id))
          .orderBy(purchaseOrderItemsTable.lineNumber);
        return {
          ...formatOrder(r.order),
          vendorName: r.vendorName ?? "",
          projectCode: r.projectCode ?? "",
          projectName: r.projectName ?? "",
          items: items.map(formatItem),
        };
      })
    );

    res.json({ items: ordersWithItems, total: ordersWithItems.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list available purchase orders");
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/purchase-orders
router.get("/", async (req, res) => {
  try {
    const { projectId, vendorId, status } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (projectId) conditions.push(eq(purchaseOrdersTable.projectId, parseInt(projectId)));
    if (vendorId) conditions.push(eq(purchaseOrdersTable.vendorId, parseInt(vendorId)));
    if (status) conditions.push(eq(purchaseOrdersTable.status, status as PurchaseOrderStatus));

    const base = db
      .select({
        order: purchaseOrdersTable,
        vendorName: vendorsTable.name,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
      })
      .from(purchaseOrdersTable)
      .leftJoin(vendorsTable, eq(purchaseOrdersTable.vendorId, vendorsTable.id))
      .leftJoin(projectsTable, eq(purchaseOrdersTable.projectId, projectsTable.id));

    const rows = await (conditions.length > 0 ? base.where(and(...conditions)) : base).orderBy(
      desc(purchaseOrdersTable.createdAt)
    );

    res.json({
      items: rows.map((r) => ({
        ...formatOrder(r.order),
        vendorName: r.vendorName ?? "",
        projectCode: r.projectCode ?? "",
        projectName: r.projectName ?? "",
      })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list purchase orders");
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/purchase-orders/:id
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db
      .select({
        order: purchaseOrdersTable,
        vendorName: vendorsTable.name,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
      })
      .from(purchaseOrdersTable)
      .leftJoin(vendorsTable, eq(purchaseOrdersTable.vendorId, vendorsTable.id))
      .leftJoin(projectsTable, eq(purchaseOrdersTable.projectId, projectsTable.id))
      .where(eq(purchaseOrdersTable.id, id));

    if (!row) return res.status(404).json({ message: "発注書が見つかりません" });

    const items = await db
      .select()
      .from(purchaseOrderItemsTable)
      .where(eq(purchaseOrderItemsTable.purchaseOrderId, id))
      .orderBy(purchaseOrderItemsTable.lineNumber);

    // この発注書に紐づく仕入伝票の件数（削除時の警告に使う）
    const [invCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseInvoicesTable)
      .where(eq(purchaseInvoicesTable.purchaseOrderId, id));

    return res.json({
      ...formatOrder(row.order),
      vendorName: row.vendorName ?? "",
      projectCode: row.projectCode ?? "",
      projectName: row.projectName ?? "",
      linkedInvoiceCount: invCount?.count ?? 0,
      items: items.map(formatItem),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get purchase order");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/purchase-orders
router.post("/", async (req, res) => {
  try {
    const { projectId, vendorId, orderDate, expectedDeliveryDate, status, notes, items } = req.body;

    if (!projectId || !vendorId || !orderDate) {
      return res.status(400).json({ message: "projectId, vendorId, orderDate は必須です" });
    }

    const orderNumber = await generateOrderNumber();
    const itemRows: ItemInput[] = items ?? [];
    const { subtotal, taxAmount, totalAmount } = calcTotals(itemRows);

    const [order] = await db
      .insert(purchaseOrdersTable)
      .values({
        orderNumber,
        projectId: parseInt(projectId),
        vendorId: parseInt(vendorId),
        orderDate,
        expectedDeliveryDate: expectedDeliveryDate ?? null,
        status: (status ?? "draft") as PurchaseOrderStatus,
        subtotal: String(subtotal),
        taxAmount: String(taxAmount),
        totalAmount: String(totalAmount),
        notes: notes ?? null,
      })
      .returning();

    let insertedItems: typeof purchaseOrderItemsTable.$inferSelect[] = [];
    if (itemRows.length > 0) {
      insertedItems = await db
        .insert(purchaseOrderItemsTable)
        .values(
          itemRows.map((item, idx) => ({
            purchaseOrderId: order.id,
            lineNumber: item.lineNumber ?? idx + 1,
            category: item.category as "material" | "labor" | "subcontract" | "expense",
            description: item.description,
            specification: item.specification ?? null,
            quantity: String(item.quantity ?? 1),
            unit: item.unit ?? "",
            unitPrice: String(item.unitPrice ?? 0),
            amount: String(item.amount ?? 0),
            taxRate: String(item.taxRate ?? 10),
            workTypeId: item.workTypeId ?? null,
          }))
        )
        .returning();
    }

    return res.status(201).json({
      ...formatOrder(order),
      items: insertedItems.map(formatItem),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create purchase order");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// PATCH /api/purchase-orders/:id
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { vendorId, orderDate, expectedDeliveryDate, status, notes, items } = req.body;

    const [existing] = await db
      .select()
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, id));
    if (!existing) return res.status(404).json({ message: "発注書が見つかりません" });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (vendorId !== undefined) updates.vendorId = parseInt(vendorId);
    if (orderDate !== undefined) updates.orderDate = orderDate;
    if (expectedDeliveryDate !== undefined) updates.expectedDeliveryDate = expectedDeliveryDate ?? null;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes ?? null;

    if (items !== undefined) {
      const itemRows: ItemInput[] = items;
      const { subtotal, taxAmount, totalAmount } = calcTotals(itemRows);
      updates.subtotal = String(subtotal);
      updates.taxAmount = String(taxAmount);
      updates.totalAmount = String(totalAmount);

      // Get the IDs of the existing purchase order items before they are deleted.
      // Only clear purchaseOrderItemId on budget_items that reference these specific
      // item IDs — not all rows linked to this PO (purchaseOrderId).
      const oldItems = await db
        .select({ id: purchaseOrderItemsTable.id })
        .from(purchaseOrderItemsTable)
        .where(eq(purchaseOrderItemsTable.purchaseOrderId, id));

      if (oldItems.length > 0) {
        const oldItemIds = oldItems.map((r) => r.id);
        await db
          .update(budgetItemsTable)
          .set({ purchaseOrderItemId: null, updatedAt: new Date() })
          .where(inArray(budgetItemsTable.purchaseOrderItemId, oldItemIds));
      }

      await db.delete(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, id));
      if (itemRows.length > 0) {
        await db.insert(purchaseOrderItemsTable).values(
          itemRows.map((item, idx) => ({
            purchaseOrderId: id,
            lineNumber: item.lineNumber ?? idx + 1,
            category: item.category as "material" | "labor" | "subcontract" | "expense",
            description: item.description,
            specification: item.specification ?? null,
            quantity: String(item.quantity ?? 1),
            unit: item.unit ?? "",
            unitPrice: String(item.unitPrice ?? 0),
            amount: String(item.amount ?? 0),
            taxRate: String(item.taxRate ?? 10),
            workTypeId: item.workTypeId ?? null,
          }))
        );
      }
    }

    const [updated] = await db
      .update(purchaseOrdersTable)
      .set(updates)
      .where(eq(purchaseOrdersTable.id, id))
      .returning();

    const newItems = await db
      .select()
      .from(purchaseOrderItemsTable)
      .where(eq(purchaseOrderItemsTable.purchaseOrderId, id))
      .orderBy(purchaseOrderItemsTable.lineNumber);

    return res.json({
      ...formatOrder(updated),
      items: newItems.map(formatItem),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update purchase order");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/purchase-orders/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db
      .select({ id: purchaseOrdersTable.id })
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, id));
    if (!existing) return res.status(404).json({ message: "発注書が見つかりません" });

    // Explicitly clear purchase order links on budget_items before deletion
    // (ON DELETE SET NULL on the FK also handles this, but we do it explicitly for consistency)
    await db
      .update(budgetItemsTable)
      .set({ purchaseOrderId: null, purchaseOrderItemId: null, updatedAt: new Date() })
      .where(eq(budgetItemsTable.purchaseOrderId, id));

    await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete purchase order");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
