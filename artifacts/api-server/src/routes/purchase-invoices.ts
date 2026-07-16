import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  purchaseInvoicesTable,
  purchaseInvoiceItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  vendorsTable,
  projectsTable,
  paymentsTable,
  costItemsTable,
} from "@workspace/db";
import type { PurchaseInvoiceStatus } from "@workspace/db";
import { withUniqueNumberTransaction, type Tx } from "../lib/unique-number";

const router: IRouter = Router();

function parseN(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) || 0 : ((v as number) ?? 0);
}

function formatInvoice(inv: typeof purchaseInvoicesTable.$inferSelect) {
  return {
    ...inv,
    subtotal: parseN(inv.subtotal),
    taxAmount: parseN(inv.taxAmount),
    totalAmount: parseN(inv.totalAmount),
  };
}

function formatItem(i: typeof purchaseInvoiceItemsTable.$inferSelect) {
  return {
    ...i,
    quantity: parseN(i.quantity),
    unitPrice: parseN(i.unitPrice),
    amount: parseN(i.amount),
    taxRate: parseN(i.taxRate),
    purchaseOrderItemId: i.purchaseOrderItemId ?? null,
    costItemId: i.costItemId ?? null,
  };
}

async function generateVoucherNumber(): Promise<string> {
  const today = new Date();
  const ymd =
    String(today.getFullYear()) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `ST-${ymd}-`;
  const all = await db
    .select({ n: purchaseInvoicesTable.voucherNumber })
    .from(purchaseInvoicesTable);
  const todayNums = all
    .map((r) => r.n)
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

interface InvoiceItemInput {
  category: string;
  description: string;
  specification?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  taxRate?: number;
  workTypeId?: number | null;
  purchaseOrderItemId?: number | null;
  lineNumber?: number;
}

function calcInvoiceTotals(items: InvoiceItemInput[]): { subtotal: number; taxAmount: number; totalAmount: number } {
  const subtotal = items.reduce((s, i) => s + (i.amount || 0), 0);
  const taxAmount = items.reduce(
    (s, i) => s + Math.floor((i.amount || 0) * (i.taxRate ?? 10) / 100),
    0
  );
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

// ── cost_items 同期ヘルパー ──────────────────────────────────────────────────

/** 仕入伝票の各明細行に対応する cost_items を作成し costItemId を更新する */
async function syncCostItemsAfterInvoice(
  tx: Tx,
  projectId: number,
  purchaseDate: string,
  voucherNumber: string,
  isProvisional: boolean,
  vendorName: string,
  vendorId: number,
  insertedItems: typeof purchaseInvoiceItemsTable.$inferSelect[]
) {
  for (const item of insertedItems) {
    const [ci] = await tx
      .insert(costItemsTable)
      .values({
        projectId,
        category: item.category as "material" | "labor" | "subcontract" | "expense",
        description: item.description,
        vendor: vendorName,
        vendorId,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        unitPrice: item.unitPrice ?? null,
        amount: item.amount,
        incurredDate: purchaseDate,
        invoiceNumber: voucherNumber,
        notes: isProvisional ? "仮伝票" : null,
        sourceType: "purchase_invoice",
        sourceId: item.id,
        workTypeId: item.workTypeId ?? null,
      })
      .returning();

    await tx
      .update(purchaseInvoiceItemsTable)
      .set({ costItemId: ci.id })
      .where(eq(purchaseInvoiceItemsTable.id, item.id));
  }
}

/** 仕入伝票に紐づく cost_items を全削除する */
async function deleteCostItemsByInvoiceId(tx: Tx, invoiceId: number) {
  const items = await tx
    .select({ costItemId: purchaseInvoiceItemsTable.costItemId })
    .from(purchaseInvoiceItemsTable)
    .where(eq(purchaseInvoiceItemsTable.purchaseInvoiceId, invoiceId));

  const costItemIds = items
    .map((i) => i.costItemId)
    .filter((id): id is number => id != null);

  if (costItemIds.length > 0) {
    await tx.delete(costItemsTable).where(inArray(costItemsTable.id, costItemIds));
  }
}

// GET /api/purchase-invoices
router.get("/", async (req, res) => {
  try {
    const { projectId, vendorId, status } = req.query as Record<string, string>;
    const conditions: ReturnType<typeof eq>[] = [];
    if (projectId) conditions.push(eq(purchaseInvoicesTable.projectId, parseInt(projectId)));
    if (vendorId) conditions.push(eq(purchaseInvoicesTable.vendorId, parseInt(vendorId)));
    if (status) conditions.push(eq(purchaseInvoicesTable.status, status as PurchaseInvoiceStatus));

    const base = db
      .select({
        inv: purchaseInvoicesTable,
        vendorName: vendorsTable.name,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
      })
      .from(purchaseInvoicesTable)
      .leftJoin(vendorsTable, eq(purchaseInvoicesTable.vendorId, vendorsTable.id))
      .leftJoin(projectsTable, eq(purchaseInvoicesTable.projectId, projectsTable.id));

    const rows = await (conditions.length > 0 ? base.where(and(...conditions)) : base).orderBy(
      desc(purchaseInvoicesTable.purchaseDate)
    );

    res.json({
      items: rows.map((r) => ({
        ...formatInvoice(r.inv),
        vendorName: r.vendorName ?? "",
        projectCode: r.projectCode ?? "",
        projectName: r.projectName ?? "",
      })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list purchase invoices");
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/purchase-invoices/:id
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db
      .select({
        inv: purchaseInvoicesTable,
        vendorName: vendorsTable.name,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
      })
      .from(purchaseInvoicesTable)
      .leftJoin(vendorsTable, eq(purchaseInvoicesTable.vendorId, vendorsTable.id))
      .leftJoin(projectsTable, eq(purchaseInvoicesTable.projectId, projectsTable.id))
      .where(eq(purchaseInvoicesTable.id, id));

    if (!row) return res.status(404).json({ message: "仕入伝票が見つかりません" });

    const items = await db
      .select()
      .from(purchaseInvoiceItemsTable)
      .where(eq(purchaseInvoiceItemsTable.purchaseInvoiceId, id))
      .orderBy(purchaseInvoiceItemsTable.lineNumber);

    return res.json({
      ...formatInvoice(row.inv),
      vendorName: row.vendorName ?? "",
      projectCode: row.projectCode ?? "",
      projectName: row.projectName ?? "",
      items: items.map(formatItem),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get purchase invoice");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/purchase-invoices
router.post("/", async (req, res) => {
  try {
    const {
      projectId, vendorId, purchaseDate, purchaseOrderId,
      paymentDueDate, status, taxCalculationMethod, isProvisional,
      invoiceRegistrationNumber, isTaxableInvoice,
      subtotal, taxAmount, totalAmount, notes, items,
      createPayment, paymentDescription,
    } = req.body;

    if (!projectId || !vendorId || !purchaseDate) {
      return res.status(400).json({ message: "projectId, vendorId, purchaseDate は必須です" });
    }

    const [vendorRow] = await db
      .select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, parseInt(vendorId)));
    const vendorName = vendorRow?.name ?? "（仕入先）";

    const itemRows: InvoiceItemInput[] = items ?? [];
    const { subtotal: calcedSubtotal, taxAmount: calcedTaxAmount, totalAmount: calcedTotalAmount } = calcInvoiceTotals(itemRows);

    // 伝票本体・明細・原価明細・発注納品数量・支払予定を1つのトランザクションで作成する。
    // 採番(voucherNumber)が重複したらトランザクションごとロールバックして採り直す。
    const { inv, insertedItems } = await withUniqueNumberTransaction(
      generateVoucherNumber,
      async (voucherNumber, tx) => {
        const [inv] = await tx
          .insert(purchaseInvoicesTable)
          .values({
            voucherNumber,
            projectId: parseInt(projectId),
            vendorId: parseInt(vendorId),
            purchaseOrderId: purchaseOrderId ? parseInt(purchaseOrderId) : null,
            purchaseDate,
            paymentDueDate: paymentDueDate ?? null,
            status: (status ?? "confirmed") as PurchaseInvoiceStatus,
            taxCalculationMethod: taxCalculationMethod ?? "detail_exclusive",
            isProvisional: isProvisional ?? false,
            invoiceRegistrationNumber: invoiceRegistrationNumber ?? null,
            isTaxableInvoice: isTaxableInvoice ?? true,
            subtotal: String(calcedSubtotal),
            taxAmount: String(calcedTaxAmount),
            totalAmount: String(calcedTotalAmount),
            notes: notes ?? null,
          })
          .returning();

        let insertedItems: typeof purchaseInvoiceItemsTable.$inferSelect[] = [];
        if (itemRows.length > 0) {
          insertedItems = await tx
            .insert(purchaseInvoiceItemsTable)
            .values(
              itemRows.map((item, idx) => ({
                purchaseInvoiceId: inv.id,
                purchaseOrderItemId: item.purchaseOrderItemId ?? null,
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

          await syncCostItemsAfterInvoice(
            tx,
            parseInt(projectId),
            purchaseDate,
            voucherNumber,
            isProvisional ?? false,
            vendorName,
            parseInt(vendorId),
            insertedItems
          );
        }

        if (purchaseOrderId) {
          await syncDeliveredQuantity(tx, parseInt(purchaseOrderId));
        }

        if (createPayment) {
          await tx.insert(paymentsTable).values({
            projectId: parseInt(projectId),
            vendor: vendorName,
            description: paymentDescription ?? `仕入伝票 ${voucherNumber}`,
            amount: String(calcedTotalAmount),
            dueDate: paymentDueDate ?? null,
            invoiceNumber: voucherNumber,
            source: "manual",
          });
        }

        return { inv, insertedItems };
      },
    );

    return res.status(201).json({
      ...formatInvoice(inv),
      voucherNumber: inv.voucherNumber,
      items: insertedItems.map(formatItem),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create purchase invoice");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/purchase-invoices/from-order/:orderId
router.post("/from-order/:orderId", async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { paymentDueDate, isProvisional, notes, createPayment } = req.body;

    const [order] = await db
      .select()
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "注文書が見つかりません" });

    const [vendorRow] = await db
      .select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, order.vendorId));
    const vendorName = vendorRow?.name ?? "（仕入先）";

    const orderItems = await db
      .select()
      .from(purchaseOrderItemsTable)
      .where(eq(purchaseOrderItemsTable.purchaseOrderId, orderId))
      .orderBy(purchaseOrderItemsTable.lineNumber);

    const purchaseDate = new Date().toISOString().split("T")[0];

    const itemRows = orderItems
      .map((oi) => {
        const remaining = parseN(oi.quantity) - parseN(oi.deliveredQuantity);
        if (remaining <= 0) return null;
        const amount = Math.floor(remaining * parseN(oi.unitPrice));
        return {
          purchaseOrderItemId: oi.id,
          lineNumber: oi.lineNumber,
          category: oi.category as "material" | "labor" | "subcontract" | "expense",
          description: oi.description,
          specification: oi.specification ?? null,
          quantity: String(remaining),
          unit: oi.unit,
          unitPrice: oi.unitPrice,
          amount: String(amount),
          taxRate: oi.taxRate,
          workTypeId: oi.workTypeId ?? null,
        };
      })
      .filter(Boolean) as NonNullable<(typeof orderItems[0] & { purchaseOrderItemId: number; quantity: string; amount: string })>[];

    if (itemRows.length === 0) {
      return res.status(400).json({ message: "未納品の明細がありません" });
    }

    const subtotal = itemRows.reduce((s, i) => s + parseN(i.amount), 0);
    const taxAmt = itemRows.reduce(
      (s, i) => s + Math.floor(parseN(i.amount) * parseN(i.taxRate) / 100),
      0
    );
    const totalAmt = subtotal + taxAmt;

    // 発注からの伝票化も、本体・明細・原価・納品数量・支払を1トランザクションで作成する。
    const { inv, insertedItems } = await withUniqueNumberTransaction(
      generateVoucherNumber,
      async (voucherNumber, tx) => {
        const [inv] = await tx
          .insert(purchaseInvoicesTable)
          .values({
            voucherNumber,
            projectId: order.projectId,
            vendorId: order.vendorId,
            purchaseOrderId: orderId,
            purchaseDate,
            paymentDueDate: paymentDueDate ?? null,
            status: "confirmed" as PurchaseInvoiceStatus,
            taxCalculationMethod: "detail_exclusive",
            isProvisional: isProvisional ?? false,
            isTaxableInvoice: true,
            subtotal: String(subtotal),
            taxAmount: String(taxAmt),
            totalAmount: String(totalAmt),
            notes: notes ?? null,
          })
          .returning();

        const insertedItems = await tx
          .insert(purchaseInvoiceItemsTable)
          .values(
            itemRows.map((item) => ({
              purchaseInvoiceId: inv.id,
              purchaseOrderItemId: item.purchaseOrderItemId,
              lineNumber: item.lineNumber,
              category: item.category,
              description: item.description,
              specification: item.specification,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              amount: item.amount,
              taxRate: item.taxRate,
              workTypeId: item.workTypeId,
            }))
          )
          .returning();

        await syncCostItemsAfterInvoice(
          tx,
          order.projectId,
          purchaseDate,
          voucherNumber,
          isProvisional ?? false,
          vendorName,
          order.vendorId,
          insertedItems
        );

        await syncDeliveredQuantity(tx, orderId);

        if (createPayment) {
          await tx.insert(paymentsTable).values({
            projectId: order.projectId,
            vendor: vendorName,
            description: `仕入伝票 ${voucherNumber}`,
            amount: String(totalAmt),
            dueDate: paymentDueDate ?? null,
            invoiceNumber: voucherNumber,
            source: "manual",
          });
        }

        return { inv, insertedItems };
      },
    );

    return res.status(201).json({
      ...formatInvoice(inv),
      items: insertedItems.map(formatItem),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create purchase invoice from order");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// PATCH /api/purchase-invoices/:id
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      purchaseDate, paymentDueDate, status, isProvisional, notes,
      subtotal, taxAmount, totalAmount, items,
    } = req.body;

    const [existing] = await db
      .select()
      .from(purchaseInvoicesTable)
      .where(eq(purchaseInvoicesTable.id, id));
    if (!existing) return res.status(404).json({ message: "仕入伝票が見つかりません" });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (purchaseDate !== undefined) updates.purchaseDate = purchaseDate;
    if (paymentDueDate !== undefined) updates.paymentDueDate = paymentDueDate ?? null;
    if (status !== undefined) updates.status = status;
    if (isProvisional !== undefined) updates.isProvisional = isProvisional;
    if (notes !== undefined) updates.notes = notes ?? null;

    // 明細の差し替え（旧cost_items削除→旧明細削除→新明細→新cost_items→納品数量）と
    // 伝票本体の更新を1トランザクションにまとめ、途中失敗で原価と伝票が食い違わないようにする。
    const updated = await db.transaction(async (tx) => {
      if (items !== undefined) {
        const itemRows: InvoiceItemInput[] = items;

        // 明細から合計を再計算（クライアント送信値は信用しない）
        const { subtotal: calcedSubtotal, taxAmount: calcedTaxAmount, totalAmount: calcedTotalAmount } = calcInvoiceTotals(itemRows);
        updates.subtotal = String(calcedSubtotal);
        updates.taxAmount = String(calcedTaxAmount);
        updates.totalAmount = String(calcedTotalAmount);

        // 1. 旧 cost_items を先に削除（costItemId 参照が必要なため items 削除より前に行う）
        await deleteCostItemsByInvoiceId(tx, id);

        // 2. 旧明細を削除
        await tx
          .delete(purchaseInvoiceItemsTable)
          .where(eq(purchaseInvoiceItemsTable.purchaseInvoiceId, id));

        // 3. 新明細を INSERT
        let newInsertedItems: typeof purchaseInvoiceItemsTable.$inferSelect[] = [];
        if (itemRows.length > 0) {
          newInsertedItems = await tx.insert(purchaseInvoiceItemsTable).values(
            itemRows.map((item, idx) => ({
              purchaseInvoiceId: id,
              purchaseOrderItemId: item.purchaseOrderItemId ?? null,
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
          ).returning();

          // 4. 新 cost_items を生成
          const [vendorRow] = await tx
            .select({ name: vendorsTable.name })
            .from(vendorsTable)
            .where(eq(vendorsTable.id, existing.vendorId));
          const vendorName = vendorRow?.name ?? "（仕入先）";

          await syncCostItemsAfterInvoice(
            tx,
            existing.projectId,
            (purchaseDate ?? existing.purchaseDate) as string,
            existing.voucherNumber,
            isProvisional !== undefined ? (isProvisional as boolean) : existing.isProvisional,
            vendorName,
            existing.vendorId,
            newInsertedItems
          );
        }

        if (existing.purchaseOrderId) {
          await syncDeliveredQuantity(tx, existing.purchaseOrderId);
        }
      }

      const [u] = await tx
        .update(purchaseInvoicesTable)
        .set(updates)
        .where(eq(purchaseInvoicesTable.id, id))
        .returning();
      return u;
    });

    const newItems = await db
      .select()
      .from(purchaseInvoiceItemsTable)
      .where(eq(purchaseInvoiceItemsTable.purchaseInvoiceId, id))
      .orderBy(purchaseInvoiceItemsTable.lineNumber);

    return res.json({
      ...formatInvoice(updated),
      items: newItems.map(formatItem),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update purchase invoice");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/purchase-invoices/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db
      .select()
      .from(purchaseInvoicesTable)
      .where(eq(purchaseInvoicesTable.id, id));
    if (!existing) return res.status(404).json({ message: "仕入伝票が見つかりません" });

    // 支払済・査定済は整合性保護のため削除不可
    if (existing.status === "paid" || existing.status === "assessed") {
      return res.status(409).json({
        message: "支払済・査定済の仕入伝票は削除できません。先に支払・査定を取り消してください。",
      });
    }

    const orderId = existing.purchaseOrderId;

    // cost_items削除・伝票削除・納品数量の再計算を1トランザクションにまとめる。
    await db.transaction(async (tx) => {
      // 1. 対応 cost_items を先に削除
      await deleteCostItemsByInvoiceId(tx, id);

      // 2. 仕入伝票削除（CASCADE で明細も削除）
      await tx.delete(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.id, id));

      // 3. 注文書の納品数量を再計算
      if (orderId) {
        await syncDeliveredQuantity(tx, orderId);
      }
    });

    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete purchase invoice");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── Helper: sync deliveredQuantity on PO items ───────────────────────────────
async function syncDeliveredQuantity(tx: Tx, purchaseOrderId: number) {
  const orderItems = await tx
    .select()
    .from(purchaseOrderItemsTable)
    .where(eq(purchaseOrderItemsTable.purchaseOrderId, purchaseOrderId));

  for (const oi of orderItems) {
    const invoiceItems = await tx
      .select({ quantity: purchaseInvoiceItemsTable.quantity })
      .from(purchaseInvoiceItemsTable)
      .innerJoin(
        purchaseInvoicesTable,
        eq(purchaseInvoiceItemsTable.purchaseInvoiceId, purchaseInvoicesTable.id)
      )
      .where(
        and(
          eq(purchaseInvoiceItemsTable.purchaseOrderItemId, oi.id),
          eq(purchaseInvoicesTable.purchaseOrderId, purchaseOrderId)
        )
      );

    const delivered = invoiceItems.reduce((s, i) => s + parseN(i.quantity), 0);
    await tx
      .update(purchaseOrderItemsTable)
      .set({ deliveredQuantity: String(delivered), updatedAt: new Date() })
      .where(eq(purchaseOrderItemsTable.id, oi.id));
  }

  const updatedItems = await tx
    .select()
    .from(purchaseOrderItemsTable)
    .where(eq(purchaseOrderItemsTable.purchaseOrderId, purchaseOrderId));

  const allDelivered = updatedItems.every(
    (i) => parseN(i.deliveredQuantity) >= parseN(i.quantity)
  );
  const anyDelivered = updatedItems.some((i) => parseN(i.deliveredQuantity) > 0);

  const [order] = await tx
    .select({ status: purchaseOrdersTable.status })
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.id, purchaseOrderId));

  if (order && order.status !== "cancelled" && order.status !== "draft") {
    const orderStatus = allDelivered ? "completed" : anyDelivered ? "partial" : "ordered";
    await tx
      .update(purchaseOrdersTable)
      .set({ status: orderStatus, updatedAt: new Date() })
      .where(eq(purchaseOrdersTable.id, purchaseOrderId));
  }
}

export default router;
