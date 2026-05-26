import { Router, type IRouter } from "express";
import { eq, and, asc, sql, inArray, isNotNull, gte, lt } from "drizzle-orm";
import {
  db,
  vendorInvoicesTable,
  vendorsTable,
  costItemsTable,
} from "@workspace/db";
import type { VendorInvoiceStatus } from "@workspace/db";

const router: IRouter = Router();

function parseN(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) || 0 : ((v as number) ?? 0);
}

function formatInvoice(inv: typeof vendorInvoicesTable.$inferSelect) {
  return {
    ...inv,
    amount: parseN(inv.amount),
    taxAmount: parseN(inv.taxAmount),
    totalAmount: parseN(inv.totalAmount),
    projectId: inv.projectId ?? null,
    invoiceNumber: inv.invoiceNumber ?? null,
    notes: inv.notes ?? null,
  };
}

// GET /api/vendor-invoices
router.get("/", async (req, res) => {
  try {
    const { vendorId, year, month } = req.query as Record<string, string>;
    const conditions = [];
    if (vendorId) conditions.push(eq(vendorInvoicesTable.vendorId, parseInt(vendorId)));
    if (year) conditions.push(eq(vendorInvoicesTable.periodYear, parseInt(year)));
    if (month) conditions.push(eq(vendorInvoicesTable.periodMonth, parseInt(month)));

    const rows = await db
      .select({ inv: vendorInvoicesTable, vendorName: vendorsTable.name })
      .from(vendorInvoicesTable)
      .leftJoin(vendorsTable, eq(vendorInvoicesTable.vendorId, vendorsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        asc(vendorInvoicesTable.periodYear),
        asc(vendorInvoicesTable.periodMonth),
        asc(vendorInvoicesTable.invoiceDate)
      );

    res.json({
      items: rows.map(r => ({ ...formatInvoice(r.inv), vendorName: r.vendorName ?? "" })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list vendor invoices");
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/vendor-invoices/reconciliation?year=&month=
router.get("/reconciliation", async (req, res) => {
  try {
    const { year, month } = req.query as Record<string, string>;
    if (!year || !month) {
      return res.status(400).json({ message: "year と month は必須です" });
    }
    const y = parseInt(year);
    const m = parseInt(month);

    const periodStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

    const [costRows, invoiceRows] = await Promise.all([
      db
        .select({
          vendorId: costItemsTable.vendorId,
          totalCost: sql<string>`COALESCE(SUM(${costItemsTable.amount}), 0)`,
        })
        .from(costItemsTable)
        .where(
          and(
            gte(costItemsTable.incurredDate, periodStart),
            lt(costItemsTable.incurredDate, nextMonth),
            isNotNull(costItemsTable.vendorId)
          )
        )
        .groupBy(costItemsTable.vendorId),

      db
        .select({
          vendorId: vendorInvoicesTable.vendorId,
          totalInvoice: sql<string>`COALESCE(SUM(${vendorInvoicesTable.amount}), 0)`,
        })
        .from(vendorInvoicesTable)
        .where(
          and(
            eq(vendorInvoicesTable.periodYear, y),
            eq(vendorInvoicesTable.periodMonth, m)
          )
        )
        .groupBy(vendorInvoicesTable.vendorId),
    ]);

    const allVendorIds = [
      ...new Set([
        ...(costRows.map(r => r.vendorId).filter((id): id is number => id != null)),
        ...invoiceRows.map(r => r.vendorId),
      ]),
    ];

    if (allVendorIds.length === 0) {
      return res.json({ year: y, month: m, items: [] });
    }

    const vendors = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(inArray(vendorsTable.id, allVendorIds));

    const costMap = new Map(costRows.map(r => [r.vendorId, parseN(r.totalCost)]));
    const invoiceMap = new Map(invoiceRows.map(r => [r.vendorId, parseN(r.totalInvoice)]));

    const items = vendors
      .map(v => {
        const purchaseInputTotal = costMap.get(v.id) ?? 0;
        const invoiceTotal = invoiceMap.get(v.id) ?? 0;
        const difference = invoiceTotal - purchaseInputTotal;
        return { vendorId: v.id, vendorName: v.name, purchaseInputTotal, invoiceTotal, difference };
      })
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "ja"));

    return res.json({ year: y, month: m, items });
  } catch (err) {
    req.log.error({ err }, "Failed to get reconciliation");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/vendor-invoices
router.post("/", async (req, res) => {
  try {
    const { vendorId, projectId, invoiceNumber, invoiceDate, periodYear, periodMonth, amount, taxRate, notes } = req.body;

    if (!vendorId || !invoiceDate || !periodYear || !periodMonth || amount === undefined) {
      return res.status(400).json({ message: "vendorId, invoiceDate, periodYear, periodMonth, amount は必須です" });
    }

    const amountNum = parseN(amount);
    const taxRateNum = parseN(taxRate ?? 10);
    const taxAmountNum = Math.round(amountNum * taxRateNum / 100);
    const totalAmountNum = amountNum + taxAmountNum;

    const [inv] = await db
      .insert(vendorInvoicesTable)
      .values({
        vendorId: parseInt(vendorId),
        projectId: projectId ? parseInt(projectId) : null,
        invoiceNumber: invoiceNumber || null,
        invoiceDate,
        periodYear: parseInt(periodYear),
        periodMonth: parseInt(periodMonth),
        amount: String(amountNum),
        taxAmount: String(taxAmountNum),
        totalAmount: String(totalAmountNum),
        notes: notes || null,
        status: "pending" as VendorInvoiceStatus,
      })
      .returning();

    return res.status(201).json(formatInvoice(inv));
  } catch (err) {
    req.log.error({ err }, "Failed to create vendor invoice");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// PATCH /api/vendor-invoices/:id
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { vendorId, projectId, invoiceNumber, invoiceDate, periodYear, periodMonth, amount, taxRate, notes, status } = req.body;

    const [existing] = await db
      .select()
      .from(vendorInvoicesTable)
      .where(eq(vendorInvoicesTable.id, id));
    if (!existing) return res.status(404).json({ message: "仕入先請求書が見つかりません" });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (vendorId !== undefined) updates.vendorId = parseInt(vendorId);
    if (projectId !== undefined) updates.projectId = projectId ? parseInt(projectId) : null;
    if (invoiceNumber !== undefined) updates.invoiceNumber = invoiceNumber || null;
    if (invoiceDate !== undefined) updates.invoiceDate = invoiceDate;
    if (periodYear !== undefined) updates.periodYear = parseInt(periodYear);
    if (periodMonth !== undefined) updates.periodMonth = parseInt(periodMonth);
    if (notes !== undefined) updates.notes = notes || null;
    if (status !== undefined) updates.status = status as VendorInvoiceStatus;

    if (amount !== undefined) {
      const amountNum = parseN(amount);
      const taxRateNum = parseN(taxRate ?? 10);
      const taxAmountNum = Math.round(amountNum * taxRateNum / 100);
      updates.amount = String(amountNum);
      updates.taxAmount = String(taxAmountNum);
      updates.totalAmount = String(amountNum + taxAmountNum);
    }

    const [updated] = await db
      .update(vendorInvoicesTable)
      .set(updates)
      .where(eq(vendorInvoicesTable.id, id))
      .returning();

    return res.json(formatInvoice(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update vendor invoice");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/vendor-invoices/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db
      .select({ id: vendorInvoicesTable.id })
      .from(vendorInvoicesTable)
      .where(eq(vendorInvoicesTable.id, id));
    if (!existing) return res.status(404).json({ message: "仕入先請求書が見つかりません" });

    await db.delete(vendorInvoicesTable).where(eq(vendorInvoicesTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete vendor invoice");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
