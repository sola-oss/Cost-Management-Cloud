import { Router, type IRouter } from "express";
import { eq, sql, and, or, ilike, inArray } from "drizzle-orm";
import { db, projectsTable, costItemsTable, budgetsTable, budgetItemsTable, invoicesTable, invoicePaymentsTable, companySettingsTable, constructionHistoriesTable } from "@workspace/db";

const router: IRouter = Router();

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : (val as number) ?? 0;
}

function toNumericString(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "string" ? parseFloat(val) : Number(val);
  return isNaN(n) ? null : String(n);
}

function toDateString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

function buildProjectListItem(project: typeof projectsTable.$inferSelect, totalBudget: number, totalActualCost: number) {
  const contractAmount = parseNumeric(project.contractAmount);
  // 粗利率は「予定」ベース：（請負金額 − 実行予算）÷ 請負金額。実行予算が未設定なら算定不可（null）
  const plannedGrossProfit = contractAmount - totalBudget;
  const grossProfitRate = (contractAmount > 0 && totalBudget > 0)
    ? Math.round((plannedGrossProfit / contractAmount) * 1000) / 10
    : null;
  const budgetUsageRate = totalBudget > 0 ? (totalActualCost / totalBudget) * 100 : 0;

  return {
    id: project.id,
    projectCode: project.projectCode,
    name: project.name,
    clientName: project.clientName,
    contractAmount,
    status: project.status,
    startDate: project.startDate,
    endDate: project.endDate,
    totalBudget,
    totalActualCost,
    budgetUsageRate: Math.round(budgetUsageRate * 10) / 10,
    grossProfitRate,
  };
}

router.get("/", async (req, res) => {
  try {
    const { status, search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (status) conditions.push(eq(projectsTable.status, status as any));
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      // 工事名・工事番号・得意先名で検索
      conditions.push(or(
        ilike(projectsTable.name, q),
        ilike(projectsTable.projectCode, q),
        ilike(projectsTable.clientName, q),
      ));
    }
    const whereConditions = conditions.length > 0 ? and(...conditions) : undefined;

    const [projects, countResult] = await Promise.all([
      db.select().from(projectsTable)
        .where(whereConditions)
        .limit(limitNum)
        .offset(offset)
        .orderBy(projectsTable.createdAt),
      db.select({ count: sql<number>`count(*)` }).from(projectsTable).where(whereConditions),
    ]);

    const projectIds = projects.map(p => p.id);

    const [budgetTotals, costTotals] = await Promise.all([
      projectIds.length > 0
        ? db.select({
            projectId: budgetItemsTable.projectId,
            total: sql<string>`SUM(${budgetItemsTable.revisedBudget})`,
          }).from(budgetItemsTable).where(inArray(budgetItemsTable.projectId, projectIds))
          .groupBy(budgetItemsTable.projectId)
        : [],
      projectIds.length > 0
        ? db.select({
            projectId: costItemsTable.projectId,
            total: sql<string>`SUM(${costItemsTable.amount})`,
          }).from(costItemsTable).where(inArray(costItemsTable.projectId, projectIds))
          .groupBy(costItemsTable.projectId)
        : [],
    ]);

    const budgetMap = new Map(budgetTotals.map(b => [b.projectId, parseFloat(b.total ?? "0")]));
    const costMap = new Map(costTotals.map(c => [c.projectId, parseFloat(c.total ?? "0")]));

    const items = projects.map(p => buildProjectListItem(p, budgetMap.get(p.id) ?? 0, costMap.get(p.id) ?? 0));

    res.json({
      items,
      total: Number(countResult[0]?.count ?? 0),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      projectCode, name, clientName, location, contractAmount, status = "planning", startDate, endDate, description,
      shortName, estimateNumber, orderType, orderDate, taxRate, taxExcludedAmount, taxAmount, taxIncludedAmount,
      overview, department, salesStaff, siteManager, category1, category2, category3,
      handoverDate, progressRate, recognitionBasis,
      projectCodeBranch, startDateActual, endDateActual, handoverDateActual,
      floorAreaTsubo, floorAreaSqm, memo, isCompleted, contractLines,
      publicPrivateType, clientCode, constructionHistoryType, constructionHistoryEngineer,
    } = req.body;

    const [project] = await db.insert(projectsTable).values({
      projectCode, name, clientName, location,
      contractAmount: String(contractAmount),
      status,
      startDate, endDate,
      description: description ?? null,
      shortName: shortName ?? null,
      estimateNumber: estimateNumber ?? null,
      orderType: orderType ?? null,
      orderDate: toDateString(orderDate),
      taxRate: toNumericString(taxRate),
      taxExcludedAmount: toNumericString(taxExcludedAmount),
      taxAmount: toNumericString(taxAmount),
      taxIncludedAmount: toNumericString(taxIncludedAmount),
      overview: overview ?? null,
      department: department ?? null,
      salesStaff: salesStaff ?? null,
      siteManager: siteManager ?? null,
      category1: category1 ?? null,
      category2: category2 ?? null,
      category3: category3 ?? null,
      handoverDate: toDateString(handoverDate),
      progressRate: progressRate ?? null,
      recognitionBasis: recognitionBasis ?? null,
      projectCodeBranch: projectCodeBranch ?? null,
      startDateActual: toDateString(startDateActual),
      endDateActual: toDateString(endDateActual),
      handoverDateActual: toDateString(handoverDateActual),
      floorAreaTsubo: toNumericString(floorAreaTsubo),
      floorAreaSqm: toNumericString(floorAreaSqm),
      memo: memo ?? null,
      isCompleted: isCompleted ?? false,
      contractLines: contractLines ?? null,
      publicPrivateType: publicPrivateType ?? null,
      clientCode: clientCode ?? null,
      constructionHistoryType: constructionHistoryType ?? null,
      constructionHistoryEngineer: constructionHistoryEngineer ?? null,
    }).returning();

    res.status(201).json({
      ...project,
      contractAmount: parseNumeric(project.contractAmount),
      taxRate: project.taxRate != null ? parseNumeric(project.taxRate) : null,
      taxExcludedAmount: project.taxExcludedAmount != null ? parseNumeric(project.taxExcludedAmount) : null,
      taxAmount: project.taxAmount != null ? parseNumeric(project.taxAmount) : null,
      taxIncludedAmount: project.taxIncludedAmount != null ? parseNumeric(project.taxIncludedAmount) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("duplicate key") && msg.includes("project_code_unique")) {
      res.status(409).json({ message: "この工事番号はすでに使用されています。工事番号を変更してください。" });
      return;
    }
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    const [costItems, budgets, budgetItemRows] = await Promise.all([
      db.select().from(costItemsTable).where(eq(costItemsTable.projectId, id)).orderBy(costItemsTable.incurredDate),
      db.select().from(budgetsTable).where(eq(budgetsTable.projectId, id)),
      db.select({ total: sql<string>`COALESCE(SUM(${budgetItemsTable.revisedBudget}),0)` })
        .from(budgetItemsTable).where(eq(budgetItemsTable.projectId, id)),
    ]);

    // 実行予算（budget_items）の合計を予算とする（旧budgetsは下の区分別表示でのみ使用）
    const totalBudget = parseNumeric(budgetItemRows[0]?.total ?? "0");
    const totalActualCost = costItems.reduce((sum, c) => sum + parseNumeric(c.amount), 0);
    const contractAmount = parseNumeric(project.contractAmount);
    const grossProfit = contractAmount - totalActualCost;
    const grossProfitRate = contractAmount > 0 ? (grossProfit / contractAmount) * 100 : 0;

    const budgetActualMap = new Map<string, number>();
    for (const ci of costItems) {
      budgetActualMap.set(ci.category, (budgetActualMap.get(ci.category) ?? 0) + parseNumeric(ci.amount));
    }

    const budgetsWithActual = budgets.map(b => {
      const actualAmount = budgetActualMap.get(b.category) ?? 0;
      const budgetAmount = parseNumeric(b.budgetAmount);
      const variance = budgetAmount - actualAmount;
      const usageRate = budgetAmount > 0 ? (actualAmount / budgetAmount) * 100 : 0;
      return {
        ...b,
        budgetAmount,
        actualAmount,
        variance,
        usageRate: Math.round(usageRate * 10) / 10,
      };
    });

    return res.json({
      ...project,
      contractAmount,
      taxRate: project.taxRate != null ? parseNumeric(project.taxRate) : null,
      taxExcludedAmount: project.taxExcludedAmount != null ? parseNumeric(project.taxExcludedAmount) : null,
      taxAmount: project.taxAmount != null ? parseNumeric(project.taxAmount) : null,
      taxIncludedAmount: project.taxIncludedAmount != null ? parseNumeric(project.taxIncludedAmount) : null,
      totalBudget,
      totalActualCost,
      grossProfit,
      grossProfitRate: Math.round(grossProfitRate * 10) / 10,
      costItems: costItems.map(ci => ({
        ...ci,
        amount: parseNumeric(ci.amount),
        quantity: ci.quantity ? parseNumeric(ci.quantity) : null,
        unitPrice: ci.unitPrice ? parseNumeric(ci.unitPrice) : null,
      })),
      budgets: budgetsWithActual,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      projectCode, name, clientName, location, contractAmount, status, startDate, endDate, completedDate, description,
      shortName, estimateNumber, orderType, orderDate, taxRate, taxExcludedAmount, taxAmount, taxIncludedAmount,
      overview, department, salesStaff, siteManager, category1, category2, category3,
      handoverDate, progressRate, recognitionBasis,
      projectCodeBranch, startDateActual, endDateActual, handoverDateActual,
      floorAreaTsubo, floorAreaSqm, memo, isCompleted, contractLines,
      publicPrivateType, clientCode, constructionHistoryType, constructionHistoryEngineer,
    } = req.body;

    const updateData: Partial<typeof projectsTable.$inferInsert> = {};
    if (projectCode !== undefined) updateData.projectCode = projectCode;
    if (name !== undefined) updateData.name = name;
    if (clientName !== undefined) updateData.clientName = clientName;
    if (location !== undefined) updateData.location = location;
    if (contractAmount !== undefined) updateData.contractAmount = String(contractAmount);
    if (status !== undefined) updateData.status = status;
    if (startDate !== undefined) updateData.startDate = startDate;
    if (endDate !== undefined) updateData.endDate = endDate;
    if (completedDate !== undefined) updateData.completedDate = completedDate;
    if (description !== undefined) updateData.description = description;
    if (shortName !== undefined) updateData.shortName = shortName;
    if (estimateNumber !== undefined) updateData.estimateNumber = estimateNumber;
    if (orderType !== undefined) updateData.orderType = orderType;
    if (orderDate !== undefined) updateData.orderDate = toDateString(orderDate);
    if (taxRate !== undefined) updateData.taxRate = toNumericString(taxRate);
    if (taxExcludedAmount !== undefined) updateData.taxExcludedAmount = toNumericString(taxExcludedAmount);
    if (taxAmount !== undefined) updateData.taxAmount = toNumericString(taxAmount);
    if (taxIncludedAmount !== undefined) updateData.taxIncludedAmount = toNumericString(taxIncludedAmount);
    if (overview !== undefined) updateData.overview = overview || null;
    if (department !== undefined) updateData.department = department || null;
    if (salesStaff !== undefined) updateData.salesStaff = salesStaff || null;
    if (siteManager !== undefined) updateData.siteManager = siteManager || null;
    if (category1 !== undefined) updateData.category1 = category1 || null;
    if (category2 !== undefined) updateData.category2 = category2 || null;
    if (category3 !== undefined) updateData.category3 = category3 || null;
    if (handoverDate !== undefined) updateData.handoverDate = toDateString(handoverDate);
    if (progressRate !== undefined) updateData.progressRate = progressRate;
    if (recognitionBasis !== undefined) updateData.recognitionBasis = recognitionBasis;
    if (projectCodeBranch !== undefined) updateData.projectCodeBranch = projectCodeBranch || null;
    if (startDateActual !== undefined) updateData.startDateActual = toDateString(startDateActual);
    if (endDateActual !== undefined) updateData.endDateActual = toDateString(endDateActual);
    if (handoverDateActual !== undefined) updateData.handoverDateActual = toDateString(handoverDateActual);
    if (floorAreaTsubo !== undefined) updateData.floorAreaTsubo = toNumericString(floorAreaTsubo);
    if (floorAreaSqm !== undefined) updateData.floorAreaSqm = toNumericString(floorAreaSqm);
    if (memo !== undefined) updateData.memo = memo || null;
    if (isCompleted !== undefined) updateData.isCompleted = isCompleted;
    if (contractLines !== undefined) updateData.contractLines = contractLines;
    if (publicPrivateType !== undefined) updateData.publicPrivateType = publicPrivateType || null;
    if (clientCode !== undefined) updateData.clientCode = clientCode || null;
    if (constructionHistoryType !== undefined) updateData.constructionHistoryType = constructionHistoryType || null;
    if (constructionHistoryEngineer !== undefined) updateData.constructionHistoryEngineer = constructionHistoryEngineer || null;
    updateData.updatedAt = new Date();

    const [updated] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "工事が見つかりません" });

    return res.json({
      ...updated,
      contractAmount: parseNumeric(updated.contractAmount),
      taxRate: updated.taxRate != null ? parseNumeric(updated.taxRate) : null,
      taxExcludedAmount: updated.taxExcludedAmount != null ? parseNumeric(updated.taxExcludedAmount) : null,
      taxAmount: updated.taxAmount != null ? parseNumeric(updated.taxAmount) : null,
      taxIncludedAmount: updated.taxIncludedAmount != null ? parseNumeric(updated.taxIncludedAmount) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(projectsTable).where(eq(projectsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/summary", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    const [costItems, budgetItemRows] = await Promise.all([
      db.select().from(costItemsTable).where(eq(costItemsTable.projectId, id)),
      db.select({ total: sql<string>`COALESCE(SUM(${budgetItemsTable.revisedBudget}),0)` })
        .from(budgetItemsTable).where(eq(budgetItemsTable.projectId, id)),
    ]);

    const costByCategory = { material: 0, labor: 0, subcontract: 0, expense: 0 };
    for (const ci of costItems) {
      costByCategory[ci.category as keyof typeof costByCategory] += parseNumeric(ci.amount);
    }

    // 実行予算（budget_items）の合計を予算とする
    const totalBudget = parseNumeric(budgetItemRows[0]?.total ?? "0");
    const totalActualCost = Object.values(costByCategory).reduce((s, v) => s + v, 0);
    const contractAmount = parseNumeric(project.contractAmount);
    // 実績粗利：請負 − 実績原価（進捗にあわせた実態）
    const grossProfit = contractAmount - totalActualCost;
    const grossProfitRate = contractAmount > 0 ? (grossProfit / contractAmount) * 100 : 0;
    // 予定粗利：請負 − 実行予算（計画段階の採算）。実行予算未設定なら算定不可（null）
    const plannedGrossProfit = contractAmount - totalBudget;
    const plannedGrossProfitRate = (contractAmount > 0 && totalBudget > 0)
      ? Math.round((plannedGrossProfit / contractAmount) * 1000) / 10
      : null;
    const budgetUsageRate = totalBudget > 0 ? (totalActualCost / totalBudget) * 100 : 0;

    return res.json({
      projectId: id,
      contractAmount,
      totalBudget,
      totalActualCost,
      grossProfit,
      grossProfitRate: Math.round(grossProfitRate * 10) / 10,
      plannedGrossProfit,
      plannedGrossProfitRate,
      budgetUsageRate: Math.round(budgetUsageRate * 10) / 10,
      costBreakdown: costByCategory,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project summary");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/ledger", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ message: "Invalid project ID" });

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    const [costItems, budgets, constructionHistory, invoiceRows, companyRows] = await Promise.all([
      db.select().from(costItemsTable).where(eq(costItemsTable.projectId, id)),
      db.select().from(budgetsTable).where(eq(budgetsTable.projectId, id)),
      db.select().from(constructionHistoriesTable).where(eq(constructionHistoriesTable.projectId, id)).then(r => r[0] ?? null),
      db.select().from(invoicesTable).where(eq(invoicesTable.projectId, id)).orderBy(invoicesTable.invoiceDate),
      db.select().from(companySettingsTable).limit(1),
    ]);

    const totalBudget = budgets.reduce((s, b) => s + parseNumeric(b.budgetAmount), 0);
    const totalActualCost = costItems.reduce((s, c) => s + parseNumeric(c.amount), 0);
    const contractAmount = parseNumeric(project.contractAmount);
    const grossProfit = contractAmount - totalActualCost;
    const grossProfitRate = contractAmount > 0 ? (grossProfit / contractAmount) * 100 : 0;

    const invoicesWithPayments = await Promise.all(
      invoiceRows.map(async (inv) => {
        const payments = await db.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, inv.id)).orderBy(invoicePaymentsTable.paymentDate);
        return {
          ...inv,
          totalAmount: parseNumeric(inv.totalAmount),
          paidAmount: parseNumeric(inv.paidAmount),
          payments: payments.map(p => ({ ...p, amount: parseNumeric(p.amount) })),
        };
      })
    );

    const totalInvoiced = invoicesWithPayments.reduce((s, inv) => s + inv.totalAmount, 0);
    const totalPaid = invoicesWithPayments.reduce((s, inv) => s + inv.paidAmount, 0);
    const totalUnpaid = totalInvoiced - totalPaid;

    return res.json({
      project: {
        ...project,
        contractAmount,
        taxExcludedAmount: project.taxExcludedAmount != null ? parseNumeric(project.taxExcludedAmount) : null,
        taxAmount: project.taxAmount != null ? parseNumeric(project.taxAmount) : null,
        taxIncludedAmount: project.taxIncludedAmount != null ? parseNumeric(project.taxIncludedAmount) : null,
        floorAreaTsubo: project.floorAreaTsubo != null ? parseNumeric(project.floorAreaTsubo) : null,
        floorAreaSqm: project.floorAreaSqm != null ? parseNumeric(project.floorAreaSqm) : null,
      },
      constructionHistory,
      invoices: invoicesWithPayments,
      companySettings: companyRows[0] ?? null,
      summary: {
        totalBudget,
        totalActualCost,
        grossProfit,
        grossProfitRate: Math.round(grossProfitRate * 10) / 10,
        totalInvoiced,
        totalPaid,
        totalUnpaid,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project ledger");
    return res.status(500).json({ message: "Internal server error" });
  }
});


export default router;
