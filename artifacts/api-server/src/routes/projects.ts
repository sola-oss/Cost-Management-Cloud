import { Router, type IRouter } from "express";
import { eq, sql, and, inArray } from "drizzle-orm";
import { db, projectsTable, costItemsTable, budgetsTable } from "@workspace/db";

const router: IRouter = Router();

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : (val as number) ?? 0;
}

function buildProjectListItem(project: typeof projectsTable.$inferSelect, totalBudget: number, totalActualCost: number) {
  const contractAmount = parseNumeric(project.contractAmount);
  const grossProfit = contractAmount - totalActualCost;
  const grossProfitRate = contractAmount > 0 ? (grossProfit / contractAmount) * 100 : 0;
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
    grossProfitRate: Math.round(grossProfitRate * 10) / 10,
  };
}

router.get("/", async (req, res) => {
  try {
    const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const whereConditions = status ? eq(projectsTable.status, status as any) : undefined;

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
            projectId: budgetsTable.projectId,
            total: sql<string>`SUM(${budgetsTable.budgetAmount})`,
          }).from(budgetsTable).where(inArray(budgetsTable.projectId, projectIds))
          .groupBy(budgetsTable.projectId)
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
    const { projectCode, name, clientName, location, contractAmount, status = "planning", startDate, endDate, description } = req.body;

    const [project] = await db.insert(projectsTable).values({
      projectCode, name, clientName, location,
      contractAmount: String(contractAmount),
      status,
      startDate, endDate,
      description: description ?? null,
    }).returning();

    res.status(201).json({
      ...project,
      contractAmount: parseNumeric(project.contractAmount),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    const [costItems, budgets] = await Promise.all([
      db.select().from(costItemsTable).where(eq(costItemsTable.projectId, id)).orderBy(costItemsTable.incurredDate),
      db.select().from(budgetsTable).where(eq(budgetsTable.projectId, id)),
    ]);

    const totalBudget = budgets.reduce((sum, b) => sum + parseNumeric(b.budgetAmount), 0);
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

    res.json({
      ...project,
      contractAmount,
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
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { projectCode, name, clientName, location, contractAmount, status, startDate, endDate, completedDate, description } = req.body;

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
    updateData.updatedAt = new Date();

    const [updated] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "工事が見つかりません" });

    res.json({ ...updated, contractAmount: parseNumeric(updated.contractAmount) });
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    res.status(500).json({ message: "Internal server error" });
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

    const [costItems, budgets] = await Promise.all([
      db.select().from(costItemsTable).where(eq(costItemsTable.projectId, id)),
      db.select().from(budgetsTable).where(eq(budgetsTable.projectId, id)),
    ]);

    const costByCategory = { material: 0, labor: 0, subcontract: 0, expense: 0 };
    for (const ci of costItems) {
      costByCategory[ci.category as keyof typeof costByCategory] += parseNumeric(ci.amount);
    }

    const totalBudget = budgets.reduce((sum, b) => sum + parseNumeric(b.budgetAmount), 0);
    const totalActualCost = Object.values(costByCategory).reduce((s, v) => s + v, 0);
    const contractAmount = parseNumeric(project.contractAmount);
    const grossProfit = contractAmount - totalActualCost;
    const grossProfitRate = contractAmount > 0 ? (grossProfit / contractAmount) * 100 : 0;
    const budgetUsageRate = totalBudget > 0 ? (totalActualCost / totalBudget) * 100 : 0;

    res.json({
      projectId: id,
      contractAmount,
      totalBudget,
      totalActualCost,
      grossProfit,
      grossProfitRate: Math.round(grossProfitRate * 10) / 10,
      budgetUsageRate: Math.round(budgetUsageRate * 10) / 10,
      costBreakdown: costByCategory,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project summary");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
