import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, budgetsTable, costItemsTable } from "@workspace/db";

const router: IRouter = Router();

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : (val as number) ?? 0;
}

router.get("/", async (req, res) => {
  try {
    const { projectId } = req.query as Record<string, string>;
    if (!projectId) return res.status(400).json({ message: "projectId is required" });

    const projectIdNum = parseInt(projectId);
    const [budgets, costItems] = await Promise.all([
      db.select().from(budgetsTable).where(eq(budgetsTable.projectId, projectIdNum)),
      db.select().from(costItemsTable).where(eq(costItemsTable.projectId, projectIdNum)),
    ]);

    const costByCategory = new Map<string, number>();
    for (const ci of costItems) {
      costByCategory.set(ci.category, (costByCategory.get(ci.category) ?? 0) + parseNumeric(ci.amount));
    }

    const items = budgets.map(b => {
      const budgetAmount = parseNumeric(b.budgetAmount);
      const actualAmount = costByCategory.get(b.category) ?? 0;
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

    const totalBudget = items.reduce((s, i) => s + i.budgetAmount, 0);
    const totalActual = items.reduce((s, i) => s + i.actualAmount, 0);
    const totalVariance = totalBudget - totalActual;

    res.json({ items, totalBudget, totalActual, totalVariance });
  } catch (err) {
    req.log.error({ err }, "Failed to list budgets");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { projectId, category, description, budgetAmount } = req.body;

    const [budget] = await db.insert(budgetsTable).values({
      projectId,
      category,
      description,
      budgetAmount: String(budgetAmount),
    }).returning();

    res.status(201).json({
      ...budget,
      budgetAmount: parseNumeric(budget.budgetAmount),
      actualAmount: 0,
      variance: parseNumeric(budget.budgetAmount),
      usageRate: 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create budget");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { category, description, budgetAmount } = req.body;

    const updateData: Partial<typeof budgetsTable.$inferInsert> = {};
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (budgetAmount !== undefined) updateData.budgetAmount = String(budgetAmount);
    updateData.updatedAt = new Date();

    const [updated] = await db.update(budgetsTable).set(updateData).where(eq(budgetsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "予算項目が見つかりません" });

    const costItems = await db.select().from(costItemsTable)
      .where(and(eq(costItemsTable.projectId, updated.projectId), eq(costItemsTable.category, updated.category)));
    const actualAmount = costItems.reduce((sum, ci) => sum + parseNumeric(ci.amount), 0);
    const budgetAmountNum = parseNumeric(updated.budgetAmount);
    const variance = budgetAmountNum - actualAmount;
    const usageRate = budgetAmountNum > 0 ? (actualAmount / budgetAmountNum) * 100 : 0;

    res.json({
      ...updated,
      budgetAmount: budgetAmountNum,
      actualAmount,
      variance,
      usageRate: Math.round(usageRate * 10) / 10,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update budget");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
