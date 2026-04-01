import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, estimatesTable, estimateItemsTable, projectsTable } from "@workspace/db";

const router: IRouter = Router();

function parseN(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) || 0 : ((v as number) ?? 0);
}

function formatEstimate(e: typeof estimatesTable.$inferSelect) {
  return {
    ...e,
    taxRate: parseN(e.taxRate),
    taxExcludedAmount: parseN(e.taxExcludedAmount),
    taxAmount: parseN(e.taxAmount),
    taxIncludedAmount: parseN(e.taxIncludedAmount),
  };
}

function formatItem(i: typeof estimateItemsTable.$inferSelect) {
  return {
    ...i,
    quantity: i.quantity != null ? parseN(i.quantity) : null,
    unitPrice: i.unitPrice != null ? parseN(i.unitPrice) : null,
    amount: parseN(i.amount),
  };
}

// ─── 見積番号自動採番 ────────────────────────────────────────────────────────
async function generateEstimateNumber(): Promise<string> {
  const today = new Date();
  const ymd =
    String(today.getFullYear()) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `MI-${ymd}-`;

  const rows = await db
    .select({ n: estimatesTable.estimateNumber })
    .from(estimatesTable)
    .where(eq(estimatesTable.estimateNumber, prefix + "0001"));

  // Get all today's estimates
  const all = await db
    .select({ n: estimatesTable.estimateNumber })
    .from(estimatesTable);

  const todayNums = all
    .map((r) => r.n)
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));

  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

// ─── GET /api/estimates ──────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { projectId, status } = req.query as Record<string, string>;
    const conditions = [];
    if (projectId) conditions.push(eq(estimatesTable.projectId, parseInt(projectId)));
    if (status) conditions.push(eq(estimatesTable.status, status as any));

    const rows = await db
      .select({
        estimate: estimatesTable,
        projectName: projectsTable.name,
        projectCode: projectsTable.projectCode,
      })
      .from(estimatesTable)
      .leftJoin(projectsTable, eq(estimatesTable.projectId, projectsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(estimatesTable.createdAt))
      .limit(200);

    res.json({
      items: rows.map((r) => ({
        ...formatEstimate(r.estimate),
        projectName: r.projectName ?? null,
        projectCode: r.projectCode ?? null,
      })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list estimates");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/estimates ─────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      projectId, estimateDate, clientName, clientAddress, subject,
      constructionPeriod, validityPeriod, paymentTerms,
      taxRate, taxExcludedAmount, taxAmount, taxIncludedAmount,
      status, notes, companyName, companyAddress, companyTel, companyStaff, memo,
    } = req.body;

    const estimateNumber = await generateEstimateNumber();

    const [row] = await db.insert(estimatesTable).values({
      estimateNumber,
      projectId: projectId ? parseInt(projectId) : null,
      estimateDate: estimateDate || new Date().toISOString().slice(0, 10),
      clientName: clientName ?? "",
      clientAddress: clientAddress ?? "",
      subject: subject ?? "",
      constructionPeriod: constructionPeriod ?? "",
      validityPeriod: validityPeriod ?? "見積日より1ヶ月",
      paymentTerms: paymentTerms ?? "別途契約書通り",
      taxRate: String(taxRate ?? "10"),
      taxExcludedAmount: String(taxExcludedAmount ?? "0"),
      taxAmount: String(taxAmount ?? "0"),
      taxIncludedAmount: String(taxIncludedAmount ?? "0"),
      status: (status as any) ?? "draft",
      notes: notes ?? "",
      companyName: companyName ?? "",
      companyAddress: companyAddress ?? "",
      companyTel: companyTel ?? "",
      companyStaff: companyStaff ?? "",
      memo: memo ?? "",
    }).returning();

    res.status(201).json(formatEstimate(row));
  } catch (err) {
    req.log.error({ err }, "Failed to create estimate");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── GET /api/estimates/:id ──────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db
      .select({
        estimate: estimatesTable,
        projectName: projectsTable.name,
        projectCode: projectsTable.projectCode,
      })
      .from(estimatesTable)
      .leftJoin(projectsTable, eq(estimatesTable.projectId, projectsTable.id))
      .where(eq(estimatesTable.id, id));

    if (!row) return res.status(404).json({ message: "Not found" });

    const items = await db
      .select()
      .from(estimateItemsTable)
      .where(eq(estimateItemsTable.estimateId, id))
      .orderBy(estimateItemsTable.rowIndex);

    res.json({
      ...formatEstimate(row.estimate),
      projectName: row.projectName ?? null,
      projectCode: row.projectCode ?? null,
      items: items.map(formatItem),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get estimate");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── PATCH /api/estimates/:id ────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      projectId, estimateDate, clientName, clientAddress, subject,
      constructionPeriod, validityPeriod, paymentTerms,
      taxRate, taxExcludedAmount, taxAmount, taxIncludedAmount,
      status, notes, companyName, companyAddress, companyTel, companyStaff, memo,
    } = req.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (projectId !== undefined) updates.projectId = projectId ? parseInt(projectId) : null;
    if (estimateDate !== undefined) updates.estimateDate = estimateDate;
    if (clientName !== undefined) updates.clientName = clientName;
    if (clientAddress !== undefined) updates.clientAddress = clientAddress;
    if (subject !== undefined) updates.subject = subject;
    if (constructionPeriod !== undefined) updates.constructionPeriod = constructionPeriod;
    if (validityPeriod !== undefined) updates.validityPeriod = validityPeriod;
    if (paymentTerms !== undefined) updates.paymentTerms = paymentTerms;
    if (taxRate !== undefined) updates.taxRate = String(taxRate);
    if (taxExcludedAmount !== undefined) updates.taxExcludedAmount = String(taxExcludedAmount);
    if (taxAmount !== undefined) updates.taxAmount = String(taxAmount);
    if (taxIncludedAmount !== undefined) updates.taxIncludedAmount = String(taxIncludedAmount);
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (companyName !== undefined) updates.companyName = companyName;
    if (companyAddress !== undefined) updates.companyAddress = companyAddress;
    if (companyTel !== undefined) updates.companyTel = companyTel;
    if (companyStaff !== undefined) updates.companyStaff = companyStaff;
    if (memo !== undefined) updates.memo = memo;

    const [row] = await db.update(estimatesTable).set(updates).where(eq(estimatesTable.id, id)).returning();
    if (!row) return res.status(404).json({ message: "Not found" });

    res.json(formatEstimate(row));
  } catch (err) {
    req.log.error({ err }, "Failed to update estimate");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── DELETE /api/estimates/:id ───────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(estimatesTable).where(eq(estimatesTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete estimate");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/estimates/:id/items (明細一括保存) ───────────────────────────
router.post("/:id/items", async (req, res) => {
  try {
    const estimateId = parseInt(req.params.id);
    const { items } = req.body as {
      items: Array<{
        rowIndex: number; level: number; workType: string; itemName: string;
        quantity: number | null; unit: string; unitPrice: number | null;
        amount: number; rowType: string; notes: string;
      }>;
    };

    // delete old items and re-insert
    await db.delete(estimateItemsTable).where(eq(estimateItemsTable.estimateId, estimateId));

    if (items && items.length > 0) {
      await db.insert(estimateItemsTable).values(
        items.map((it, idx) => ({
          estimateId,
          rowIndex: it.rowIndex ?? idx,
          level: it.level ?? 1,
          workType: it.workType ?? "",
          itemName: it.itemName ?? "",
          quantity: it.quantity != null ? String(it.quantity) : null,
          unit: it.unit ?? "",
          unitPrice: it.unitPrice != null ? String(it.unitPrice) : null,
          amount: String(it.amount ?? 0),
          rowType: (it.rowType as any) ?? "normal",
          notes: it.notes ?? "",
        }))
      );
    }

    const saved = await db
      .select()
      .from(estimateItemsTable)
      .where(eq(estimateItemsTable.estimateId, estimateId))
      .orderBy(estimateItemsTable.rowIndex);

    res.json({ items: saved.map(formatItem) });
  } catch (err) {
    req.log.error({ err }, "Failed to save estimate items");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/estimates/:id/duplicate (複写) ────────────────────────────────
router.post("/:id/duplicate", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [orig] = await db.select().from(estimatesTable).where(eq(estimatesTable.id, id));
    if (!orig) return res.status(404).json({ message: "Not found" });

    const origItems = await db.select().from(estimateItemsTable).where(eq(estimateItemsTable.estimateId, id));

    const newNumber = await generateEstimateNumber();
    const today = new Date().toISOString().slice(0, 10);

    const [newEst] = await db.insert(estimatesTable).values({
      estimateNumber: newNumber,
      projectId: orig.projectId,
      estimateDate: today,
      clientName: orig.clientName,
      clientAddress: orig.clientAddress,
      subject: orig.subject,
      constructionPeriod: orig.constructionPeriod,
      validityPeriod: orig.validityPeriod,
      paymentTerms: orig.paymentTerms,
      taxRate: orig.taxRate,
      taxExcludedAmount: orig.taxExcludedAmount,
      taxAmount: orig.taxAmount,
      taxIncludedAmount: orig.taxIncludedAmount,
      status: "draft",
      notes: orig.notes,
      companyName: orig.companyName,
      companyAddress: orig.companyAddress,
      companyTel: orig.companyTel,
      companyStaff: orig.companyStaff,
      memo: orig.memo,
    }).returning();

    if (origItems.length > 0) {
      await db.insert(estimateItemsTable).values(
        origItems.map((it) => ({
          estimateId: newEst.id,
          rowIndex: it.rowIndex,
          level: it.level,
          workType: it.workType,
          itemName: it.itemName,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          amount: it.amount,
          rowType: it.rowType,
          notes: it.notes,
        }))
      );
    }

    res.status(201).json(formatEstimate(newEst));
  } catch (err) {
    req.log.error({ err }, "Failed to duplicate estimate");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
