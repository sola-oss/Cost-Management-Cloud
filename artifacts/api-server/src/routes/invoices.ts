import { Router, type IRouter } from "express";
import { eq, desc, ne, and, lt, or } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, invoicePaymentsTable, projectsTable } from "@workspace/db";

const router: IRouter = Router();

function parseN(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) || 0 : ((v as number) ?? 0);
}

function formatInvoice(inv: typeof invoicesTable.$inferSelect) {
  return {
    ...inv,
    taxExcludedAmount10: parseN(inv.taxExcludedAmount10),
    taxAmount10: parseN(inv.taxAmount10),
    taxExcludedAmount8: parseN(inv.taxExcludedAmount8),
    taxAmount8: parseN(inv.taxAmount8),
    taxExcludedTotal: parseN(inv.taxExcludedTotal),
    taxTotal: parseN(inv.taxTotal),
    totalAmount: parseN(inv.totalAmount),
    paidAmount: parseN(inv.paidAmount),
    billingType: inv.billingType ?? "full",
  };
}

function formatItem(i: typeof invoiceItemsTable.$inferSelect) {
  return {
    ...i,
    quantity: parseN(i.quantity),
    unitPrice: parseN(i.unitPrice),
    taxRate: parseN(i.taxRate),
    amount: parseN(i.amount),
    budgetItemId: i.budgetItemId ?? null,
  };
}

function formatPayment(p: typeof invoicePaymentsTable.$inferSelect) {
  return {
    ...p,
    amount: parseN(p.amount),
  };
}

async function generateInvoiceNumber(): Promise<string> {
  const today = new Date();
  const ymd =
    String(today.getFullYear()) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `INV-${ymd}-`;

  const all = await db.select({ n: invoicesTable.invoiceNumber }).from(invoicesTable);
  const todayNums = all
    .map((r) => r.n)
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

async function recalcStatus(invoiceId: number) {
  const [inv] = await db.select({ totalAmount: invoicesTable.totalAmount }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!inv) return;

  const payments = await db.select({ amount: invoicePaymentsTable.amount }).from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, invoiceId));
  const paidTotal = payments.reduce((s, p) => s + parseN(p.amount), 0);
  const total = parseN(inv.totalAmount);

  let status: "unpaid" | "partial" | "paid" = "unpaid";
  if (paidTotal >= total && total > 0) {
    status = "paid";
  } else if (paidTotal > 0) {
    status = "partial";
  }

  await db.update(invoicesTable).set({
    paidAmount: String(paidTotal),
    status,
    updatedAt: new Date(),
  }).where(eq(invoicesTable.id, invoiceId));
}

/**
 * Compute billedToDate: sum of totalAmount for invoices of the same project
 * that precede the current invoice chronologically (invoiceDate < current, or same
 * date with lower id). Excludes the current invoice itself.
 */
async function computeBilledToDate(projectId: number, currentId: number, currentDate: string): Promise<number> {
  const pastInvoices = await db
    .select({ totalAmount: invoicesTable.totalAmount })
    .from(invoicesTable)
    .where(and(
      eq(invoicesTable.projectId, projectId),
      ne(invoicesTable.id, currentId),
      or(
        lt(invoicesTable.invoiceDate, currentDate),
        and(
          eq(invoicesTable.invoiceDate, currentDate),
          lt(invoicesTable.id, currentId)
        )
      )
    ));
  return pastInvoices.reduce((s, inv) => s + parseN(inv.totalAmount), 0);
}

/**
 * 出来高請求の基準となる契約金額 = 工事の請負金額（projects.contractAmount）。
 * 実行予算（内部の原価予算）ではなく、お客様との請負金額を使う。
 */
async function getContractAmount(projectId: number): Promise<number> {
  const [proj] = await db
    .select({ contractAmount: projectsTable.contractAmount })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  return proj ? parseN(proj.contractAmount) : 0;
}

// ─── GET /api/invoices ────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(invoicesTable)
      .orderBy(desc(invoicesTable.createdAt))
      .limit(2000);

    res.json({
      items: rows.map(formatInvoice),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list invoices");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/invoices ───────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const b = req.body;
    const invoiceNumber = await generateInvoiceNumber();
    const today = new Date().toISOString().slice(0, 10);

    const [row] = await db.insert(invoicesTable).values({
      invoiceNumber,
      invoiceDate: b.invoiceDate || today,
      dueDate: b.dueDate || null,
      clientId: b.clientId ? parseInt(b.clientId) : null,
      clientName: b.clientName ?? "",
      clientAddress: b.clientAddress ?? "",
      projectId: b.projectId ? parseInt(b.projectId) : null,
      projectName: b.projectName ?? "",
      invoiceRegistrationNumber: b.invoiceRegistrationNumber ?? "",
      billingType: b.billingType === "progress" ? "progress" : "full",
      taxExcludedAmount10: String(b.taxExcludedAmount10 ?? 0),
      taxAmount10: String(b.taxAmount10 ?? 0),
      taxExcludedAmount8: String(b.taxExcludedAmount8 ?? 0),
      taxAmount8: String(b.taxAmount8 ?? 0),
      taxExcludedTotal: String(b.taxExcludedTotal ?? 0),
      taxTotal: String(b.taxTotal ?? 0),
      totalAmount: String(b.totalAmount ?? 0),
      paidAmount: "0",
      status: "unpaid",
      notes: b.notes ?? "",
    }).returning();

    res.status(201).json(formatInvoice(row));
  } catch (err) {
    req.log.error({ err }, "Failed to create invoice");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── GET /api/invoices/:id ────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!row) return res.status(404).json({ message: "Not found" });

    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id)).orderBy(invoiceItemsTable.rowIndex);
    const payments = await db.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, id)).orderBy(invoicePaymentsTable.paymentDate);

    let contractAmount = 0;
    let billedToDate = 0;

    if (row.projectId) {
      contractAmount = await getContractAmount(row.projectId);
      billedToDate = await computeBilledToDate(row.projectId, id, row.invoiceDate);
    }

    return res.json({
      ...formatInvoice(row),
      items: items.map(formatItem),
      payments: payments.map(formatPayment),
      contractAmount,
      billedToDate,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get invoice");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── PATCH /api/invoices/:id ──────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const b = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };

    const fields = [
      "invoiceDate", "dueDate", "clientName", "clientAddress",
      "projectName", "invoiceRegistrationNumber", "notes",
    ];
    for (const f of fields) {
      if (b[f] !== undefined) updates[f] = b[f];
    }
    if (b.clientId !== undefined) updates.clientId = b.clientId ? parseInt(b.clientId) : null;
    if (b.projectId !== undefined) updates.projectId = b.projectId ? parseInt(b.projectId) : null;
    if (b.billingType !== undefined) updates.billingType = b.billingType === "progress" ? "progress" : "full";

    const numFields = [
      "taxExcludedAmount10", "taxAmount10", "taxExcludedAmount8", "taxAmount8",
      "taxExcludedTotal", "taxTotal", "totalAmount",
    ];
    for (const f of numFields) {
      if (b[f] !== undefined) updates[f] = String(b[f]);
    }

    const [row] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();
    if (!row) return res.status(404).json({ message: "Not found" });

    await recalcStatus(id);
    const [updated] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id)).orderBy(invoiceItemsTable.rowIndex);
    const payments = await db.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, id)).orderBy(invoicePaymentsTable.paymentDate);

    let contractAmount = 0;
    let billedToDate = 0;

    if (updated.projectId) {
      contractAmount = await getContractAmount(updated.projectId);
      billedToDate = await computeBilledToDate(updated.projectId, id, updated.invoiceDate);
    }

    return res.json({
      ...formatInvoice(updated),
      items: items.map(formatItem),
      payments: payments.map(formatPayment),
      contractAmount,
      billedToDate,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update invoice");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── DELETE /api/invoices/:id ─────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    await db.delete(invoicesTable).where(eq(invoicesTable.id, parseInt(req.params.id)));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete invoice");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/invoices/:id/items ─────────────────────────────────────────────
router.post("/:id/items", async (req, res) => {
  try {
    const invoiceId = parseInt(req.params.id);
    const { items } = req.body;

    await db.delete(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId));

    if (items && items.length > 0) {
      await db.insert(invoiceItemsTable).values(
        items.map((it: any, idx: number) => ({
          invoiceId,
          rowIndex: it.rowIndex ?? idx,
          itemName: it.itemName ?? "",
          quantity: String(it.quantity ?? 1),
          unit: it.unit ?? "",
          unitPrice: String(it.unitPrice ?? 0),
          taxRate: String(it.taxRate ?? 10),
          amount: String(it.amount ?? 0),
          budgetItemId: it.budgetItemId ? parseInt(it.budgetItemId) : null,
        }))
      );
    }

    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!inv) return res.status(404).json({ message: "Not found" });

    const saved = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId)).orderBy(invoiceItemsTable.rowIndex);
    return res.json({ items: saved.map(formatItem) });
  } catch (err) {
    req.log.error({ err }, "Failed to save invoice items");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
