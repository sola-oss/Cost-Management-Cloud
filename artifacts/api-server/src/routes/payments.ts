import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, paymentsTable, projectsTable } from "@workspace/db";

const router: IRouter = Router();

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : ((val as number) ?? 0);
}

function formatPayment(p: typeof paymentsTable.$inferSelect) {
  return {
    ...p,
    amount: parseNumeric(p.amount),
    paidAmount: p.paidAmount != null ? parseNumeric(p.paidAmount) : null,
  };
}

// GET /api/payments — 支払一覧（projectId任意, status任意）
router.get("/", async (req, res) => {
  try {
    const { projectId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (projectId) conditions.push(eq(paymentsTable.projectId, parseInt(projectId)));
    if (status) conditions.push(eq(paymentsTable.status, status as any));

    const rows = await db
      .select({
        payment: paymentsTable,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
      })
      .from(paymentsTable)
      .innerJoin(projectsTable, eq(paymentsTable.projectId, projectsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(paymentsTable.createdAt))
      .limit(200);

    const totalAmount = rows.reduce((s, r) => s + parseNumeric(r.payment.amount), 0);
    const paidAmount = rows
      .filter((r) => r.payment.status === "paid")
      .reduce((s, r) => s + parseNumeric(r.payment.amount), 0);

    res.json({
      items: rows.map((r) => ({
        ...formatPayment(r.payment),
        projectCode: r.projectCode,
        projectName: r.projectName,
      })),
      total: rows.length,
      totalAmount,
      paidAmount,
      pendingAmount: totalAmount - paidAmount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list payments");
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/payments — 支払登録
router.post("/", async (req, res) => {
  try {
    const { projectId, vendor, description, amount, dueDate, invoiceNumber, notes } = req.body;

    if (!projectId || !vendor || !description || amount == null) {
      return res.status(400).json({ message: "projectId, vendor, description, amount は必須です" });
    }

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        projectId,
        vendor,
        description,
        amount: String(amount),
        paidAmount: null,
        dueDate: dueDate ?? null,
        paidDate: null,
        status: "pending",
        invoiceNumber: invoiceNumber ?? null,
        notes: notes ?? null,
      })
      .returning();

    res.status(201).json(formatPayment(payment));
  } catch (err) {
    req.log.error({ err }, "Failed to create payment");
    res.status(500).json({ message: "Internal server error" });
  }
});

// PATCH /api/payments/:id/pay — 支払済みにマーク
router.patch("/:id/pay", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { paidDate, paidAmount } = req.body;

    const existing = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
    if (!existing[0]) return res.status(404).json({ message: "支払が見つかりません" });

    const totalAmount = parseNumeric(existing[0].amount);
    const paid = paidAmount != null ? Number(paidAmount) : totalAmount;
    const newStatus = paid >= totalAmount ? "paid" : "partial";

    const [updated] = await db
      .update(paymentsTable)
      .set({
        paidDate: paidDate ?? new Date().toISOString().split("T")[0],
        paidAmount: String(paid),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(paymentsTable.id, id))
      .returning();

    res.json(formatPayment(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to mark payment as paid");
    res.status(500).json({ message: "Internal server error" });
  }
});

// PATCH /api/payments/:id/unpay — 未払いに戻す
router.patch("/:id/unpay", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const [updated] = await db
      .update(paymentsTable)
      .set({ paidDate: null, paidAmount: null, status: "pending", updatedAt: new Date() })
      .where(eq(paymentsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ message: "支払が見つかりません" });
    res.json(formatPayment(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to revert payment");
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/payments/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(paymentsTable).where(eq(paymentsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete payment");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
