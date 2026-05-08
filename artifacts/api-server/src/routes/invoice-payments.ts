import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, invoicesTable, invoicePaymentsTable } from "@workspace/db";

const router: IRouter = Router({ mergeParams: true });

function parseN(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) || 0 : ((v as number) ?? 0);
}

function formatPayment(p: typeof invoicePaymentsTable.$inferSelect) {
  return {
    ...p,
    amount: parseN(p.amount),
  };
}

function formatInvoice(inv: typeof invoicesTable.$inferSelect) {
  return {
    ...inv,
    totalAmount: parseN(inv.totalAmount),
    paidAmount: parseN(inv.paidAmount),
  };
}

async function recalcStatus(invoiceId: number) {
  const [inv] = await db
    .select({ totalAmount: invoicesTable.totalAmount })
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));
  if (!inv) return;

  const payments = await db
    .select({ amount: invoicePaymentsTable.amount })
    .from(invoicePaymentsTable)
    .where(eq(invoicePaymentsTable.invoiceId, invoiceId));
  const paidTotal = payments.reduce((sum, p) => sum + parseN(p.amount), 0);
  const total = parseN(inv.totalAmount);

  let status: "unpaid" | "partial" | "paid" = "unpaid";
  if (paidTotal >= total && total > 0) {
    status = "paid";
  } else if (paidTotal > 0) {
    status = "partial";
  }

  await db
    .update(invoicesTable)
    .set({ paidAmount: String(paidTotal), status, updatedAt: new Date() })
    .where(eq(invoicesTable.id, invoiceId));
}

// ─── GET /api/invoices/:id/payments ────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const invoiceId = parseInt(p.id);
    const payments = await db
      .select()
      .from(invoicePaymentsTable)
      .where(eq(invoicePaymentsTable.invoiceId, invoiceId))
      .orderBy(invoicePaymentsTable.paymentDate);
    res.json({ items: payments.map(formatPayment) });
  } catch (err) {
    req.log.error({ err }, "Failed to list payments");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/invoices/:id/payments ──────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const invoiceId = parseInt(p.id);
    const { paymentDate, amount, paymentMethod, notes } = req.body;

    if (!paymentDate || !amount) {
      return res.status(400).json({ message: "入金日と入金金額は必須です" });
    }

    const [payment] = await db
      .insert(invoicePaymentsTable)
      .values({
        invoiceId,
        paymentDate,
        amount: String(amount),
        paymentMethod: paymentMethod ?? "振込",
        notes: notes ?? "",
      })
      .returning();

    await recalcStatus(invoiceId);

    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    const payments = await db
      .select()
      .from(invoicePaymentsTable)
      .where(eq(invoicePaymentsTable.invoiceId, invoiceId))
      .orderBy(invoicePaymentsTable.paymentDate);

    return res.status(201).json({
      payment: formatPayment(payment),
      invoice: formatInvoice(inv),
      payments: payments.map(formatPayment),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create payment");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── PATCH /api/invoices/:id/payments/:pid ────────────────────────────────────
router.patch("/:pid", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const invoiceId = parseInt(p.id);
    const paymentId = parseInt(p.pid);
    const { paymentDate, amount, paymentMethod, notes } = req.body;

    const [existing] = await db
      .select({ id: invoicePaymentsTable.id })
      .from(invoicePaymentsTable)
      .where(and(eq(invoicePaymentsTable.id, paymentId), eq(invoicePaymentsTable.invoiceId, invoiceId)));
    if (!existing) return res.status(404).json({ message: "Payment not found" });

    const updates: Record<string, unknown> = {};
    if (paymentDate !== undefined) updates.paymentDate = paymentDate;
    if (amount !== undefined) updates.amount = String(amount);
    if (paymentMethod !== undefined) updates.paymentMethod = paymentMethod;
    if (notes !== undefined) updates.notes = notes;

    const [payment] = await db
      .update(invoicePaymentsTable)
      .set(updates)
      .where(and(eq(invoicePaymentsTable.id, paymentId), eq(invoicePaymentsTable.invoiceId, invoiceId)))
      .returning();

    await recalcStatus(invoiceId);

    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    const payments = await db
      .select()
      .from(invoicePaymentsTable)
      .where(eq(invoicePaymentsTable.invoiceId, invoiceId))
      .orderBy(invoicePaymentsTable.paymentDate);

    return res.json({
      payment: formatPayment(payment),
      invoice: formatInvoice(inv),
      payments: payments.map(formatPayment),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update payment");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── DELETE /api/invoices/:id/payments/:pid ────────────────────────────────────
router.delete("/:pid", async (req, res) => {
  try {
    const p = req.params as Record<string, string>;
    const invoiceId = parseInt(p.id);
    const paymentId = parseInt(p.pid);

    const [existing] = await db
      .select({ id: invoicePaymentsTable.id })
      .from(invoicePaymentsTable)
      .where(and(eq(invoicePaymentsTable.id, paymentId), eq(invoicePaymentsTable.invoiceId, invoiceId)));
    if (!existing) return res.status(404).json({ message: "Payment not found" });

    await db
      .delete(invoicePaymentsTable)
      .where(and(eq(invoicePaymentsTable.id, paymentId), eq(invoicePaymentsTable.invoiceId, invoiceId)));
    await recalcStatus(invoiceId);

    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    const payments = await db
      .select()
      .from(invoicePaymentsTable)
      .where(eq(invoicePaymentsTable.invoiceId, invoiceId))
      .orderBy(invoicePaymentsTable.paymentDate);

    return res.json({
      invoice: formatInvoice(inv),
      payments: payments.map(formatPayment),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to delete payment");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
