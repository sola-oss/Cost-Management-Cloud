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

async function generateEstimateNumber(): Promise<string> {
  const today = new Date();
  const ymd =
    String(today.getFullYear()) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `MI-${ymd}-`;

  const all = await db.select({ n: estimatesTable.estimateNumber }).from(estimatesTable);
  const todayNums = all
    .map((r) => r.n)
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function extractBody(body: any) {
  return {
    projectId: body.projectId !== undefined ? (body.projectId ? parseInt(body.projectId) : null) : undefined,
    estimateDate: body.estimateDate,
    createdDate: body.createdDate ?? null,
    clientName: body.clientName,
    clientAddress: body.clientAddress,
    subject: body.subject,
    location: body.location,
    constructionPeriod: body.constructionPeriod,
    validityPeriod: body.validityPeriod,
    paymentTerms: body.paymentTerms,
    taxRate: body.taxRate !== undefined ? String(body.taxRate) : undefined,
    taxExcludedAmount: body.taxExcludedAmount !== undefined ? String(body.taxExcludedAmount) : undefined,
    taxAmount: body.taxAmount !== undefined ? String(body.taxAmount) : undefined,
    taxIncludedAmount: body.taxIncludedAmount !== undefined ? String(body.taxIncludedAmount) : undefined,
    status: body.status,
    notes: body.notes,
    architectFirm: body.architectFirm,
    companyName: body.companyName,
    companyAddress: body.companyAddress,
    companyTel: body.companyTel,
    companyFax: body.companyFax,
    companyStaff: body.companyStaff,
    department: body.department,
    memo: body.memo,
  };
}

// ─── GET /api/estimates ──────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { projectId, status } = req.query as Record<string, string>;
    const conditions = [];
    if (projectId) conditions.push(eq(estimatesTable.projectId, parseInt(projectId)));
    if (status) conditions.push(eq(estimatesTable.status, status as any));

    const rows = await db
      .select({ estimate: estimatesTable, projectName: projectsTable.name, projectCode: projectsTable.projectCode })
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
    const b = extractBody(req.body);
    const estimateNumber = await generateEstimateNumber();
    const today = new Date().toISOString().slice(0, 10);

    const [row] = await db.insert(estimatesTable).values({
      estimateNumber,
      projectId: b.projectId ?? null,
      estimateDate: b.estimateDate || today,
      createdDate: b.createdDate || today,
      clientName: b.clientName ?? "",
      clientAddress: b.clientAddress ?? "",
      subject: b.subject ?? "",
      location: b.location ?? "",
      constructionPeriod: b.constructionPeriod ?? "",
      validityPeriod: b.validityPeriod ?? "見積日より1ヶ月",
      paymentTerms: b.paymentTerms ?? "別途契約書通り",
      taxRate: b.taxRate ?? "10",
      taxExcludedAmount: b.taxExcludedAmount ?? "0",
      taxAmount: b.taxAmount ?? "0",
      taxIncludedAmount: b.taxIncludedAmount ?? "0",
      status: (b.status as any) ?? "draft",
      notes: b.notes ?? "",
      architectFirm: b.architectFirm ?? "",
      companyName: b.companyName ?? "",
      companyAddress: b.companyAddress ?? "",
      companyTel: b.companyTel ?? "",
      companyFax: b.companyFax ?? "",
      companyStaff: b.companyStaff ?? "",
      department: b.department ?? "",
      memo: b.memo ?? "",
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
      .select({ estimate: estimatesTable, projectName: projectsTable.name, projectCode: projectsTable.projectCode })
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
    const b = extractBody(req.body);
    const updates: Record<string, any> = { updatedAt: new Date() };

    const fields: (keyof typeof b)[] = [
      "projectId", "estimateDate", "createdDate", "clientName", "clientAddress",
      "subject", "location", "constructionPeriod", "validityPeriod", "paymentTerms",
      "taxRate", "taxExcludedAmount", "taxAmount", "taxIncludedAmount",
      "status", "notes", "architectFirm", "companyName", "companyAddress",
      "companyTel", "companyFax", "companyStaff", "department", "memo",
    ];
    for (const f of fields) {
      if (b[f] !== undefined) updates[f] = b[f];
    }

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
    await db.delete(estimatesTable).where(eq(estimatesTable.id, parseInt(req.params.id)));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete estimate");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/estimates/:id/items ───────────────────────────────────────────
router.post("/:id/items", async (req, res) => {
  try {
    const estimateId = parseInt(req.params.id);
    const { items } = req.body;

    await db.delete(estimateItemsTable).where(eq(estimateItemsTable.estimateId, estimateId));

    if (items && items.length > 0) {
      await db.insert(estimateItemsTable).values(
        items.map((it: any, idx: number) => ({
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

// ─── POST /api/estimates/:id/duplicate ───────────────────────────────────────
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
      createdDate: today,
      clientName: orig.clientName,
      clientAddress: orig.clientAddress,
      subject: orig.subject,
      location: orig.location,
      constructionPeriod: orig.constructionPeriod,
      validityPeriod: orig.validityPeriod,
      paymentTerms: orig.paymentTerms,
      taxRate: orig.taxRate,
      taxExcludedAmount: orig.taxExcludedAmount,
      taxAmount: orig.taxAmount,
      taxIncludedAmount: orig.taxIncludedAmount,
      status: "draft",
      notes: orig.notes,
      architectFirm: orig.architectFirm,
      companyName: orig.companyName,
      companyAddress: orig.companyAddress,
      companyTel: orig.companyTel,
      companyFax: orig.companyFax,
      companyStaff: orig.companyStaff,
      department: orig.department,
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
