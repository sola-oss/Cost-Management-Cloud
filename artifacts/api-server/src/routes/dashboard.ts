import { Router, type IRouter } from "express";
import { eq, sql, desc, inArray } from "drizzle-orm";
import { db, projectsTable, costItemsTable, budgetItemsTable, paymentsTable, invoicesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : (val as number) ?? 0;
}

const categoryLabels: Record<string, string> = {
  material: "材料費",
  labor: "労務費",
  subcontract: "外注費",
  expense: "経費",
};

router.get("/overview", async (_req, res) => {
  try {
    const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));

    const totalProjects = projects.length;
    const activeProjects = projects.filter(p => p.status === "active").length;
    const completedProjects = projects.filter(p => p.status === "completed").length;

    const projectIds = projects.map(p => p.id);

    const [budgetTotals, costTotals] = await Promise.all([
      projectIds.length > 0
        ? db.select({
            projectId: budgetItemsTable.projectId,
            total: sql<string>`SUM(${budgetItemsTable.revisedBudget})`,
          }).from(budgetItemsTable).where(inArray(budgetItemsTable.projectId, projectIds)).groupBy(budgetItemsTable.projectId)
        : [],
      projectIds.length > 0
        ? db.select({
            projectId: costItemsTable.projectId,
            total: sql<string>`SUM(${costItemsTable.amount})`,
          }).from(costItemsTable).where(inArray(costItemsTable.projectId, projectIds)).groupBy(costItemsTable.projectId)
        : [],
    ]);

    const budgetMap = new Map(budgetTotals.map(b => [b.projectId, parseFloat(b.total ?? "0")]));
    const costMap = new Map(costTotals.map(c => [c.projectId, parseFloat(c.total ?? "0")]));

    const totalContractAmount = projects.reduce((sum, p) => sum + parseNumeric(p.contractAmount), 0);
    const totalActualCost = Array.from(costMap.values()).reduce((s, v) => s + v, 0);

    // 平均粗利率は「予定」ベース：（請負 − 実行予算）÷ 請負。実行予算が設定された工事だけで平均する
    const plannedRates = projects
      .filter(p => (budgetMap.get(p.id) ?? 0) > 0 && parseNumeric(p.contractAmount) > 0)
      .map(p => {
        const contractAmount = parseNumeric(p.contractAmount);
        const budget = budgetMap.get(p.id) ?? 0;
        return ((contractAmount - budget) / contractAmount) * 100;
      });
    const averageGrossProfitRate = plannedRates.length > 0
      ? Math.round((plannedRates.reduce((s, r) => s + r, 0) / plannedRates.length) * 10) / 10
      : 0;

    function buildItem(p: typeof projectsTable.$inferSelect) {
      const contractAmount = parseNumeric(p.contractAmount);
      const totalBudget = budgetMap.get(p.id) ?? 0;
      const totalActualCost = costMap.get(p.id) ?? 0;
      // 予定粗利率（請負 − 実行予算）に統一
      const grossProfitRate = (contractAmount > 0 && totalBudget > 0)
        ? Math.round(((contractAmount - totalBudget) / contractAmount) * 1000) / 10
        : 0;
      const budgetUsageRate = totalBudget > 0 ? (totalActualCost / totalBudget) * 100 : 0;
      return {
        id: p.id, projectCode: p.projectCode, name: p.name, clientName: p.clientName,
        contractAmount, status: p.status, startDate: p.startDate, endDate: p.endDate,
        totalBudget, totalActualCost,
        budgetUsageRate: Math.round(budgetUsageRate * 10) / 10,
        grossProfitRate: Math.round(grossProfitRate * 10) / 10,
      };
    }

    const recentProjects = projects.slice(0, 5).map(buildItem);
    const alertProjects = projects
      .map(buildItem)
      .filter(p => p.budgetUsageRate > 80 && p.status === "active")
      .slice(0, 5);

    // 予定粗利額(¥) = Σ（請負金額 − 実行予算）。実行予算がある工事のみ
    const plannedGrossProfit = projects.reduce((s, p) => {
      const budget = budgetMap.get(p.id) ?? 0;
      const contract = parseNumeric(p.contractAmount);
      return (budget > 0 && contract > 0) ? s + (contract - budget) : s;
    }, 0);

    // ── お金まわり（期日超過・今月の支払/入金予定） ──
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + "01";
    const [yy, mm] = today.split("-").map(Number);
    const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const monthEnd = `${today.slice(0, 8)}${String(lastDay).padStart(2, "0")}`;

    // 未払/一部のみ集計対象。SQL側で status を絞って読み込む行数を減らす（結果は不変）。
    const [pays, invs] = await Promise.all([
      db.select({ amount: paymentsTable.amount, paidAmount: paymentsTable.paidAmount, dueDate: paymentsTable.dueDate, status: paymentsTable.status }).from(paymentsTable).where(inArray(paymentsTable.status, ["pending", "partial"])),
      db.select({ totalAmount: invoicesTable.totalAmount, paidAmount: invoicesTable.paidAmount, dueDate: invoicesTable.dueDate, status: invoicesTable.status }).from(invoicesTable).where(inArray(invoicesTable.status, ["unpaid", "partial"])),
    ]);

    let overduePayCount = 0, overduePayAmount = 0, thisMonthPayAmount = 0;
    for (const p of pays) {
      if (p.status !== "pending" && p.status !== "partial") continue;
      const remain = parseNumeric(p.amount) - parseNumeric(p.paidAmount ?? 0);
      if (remain <= 0) continue;
      if (p.dueDate && p.dueDate < today) { overduePayCount++; overduePayAmount += remain; }
      if (p.dueDate && p.dueDate >= monthStart && p.dueDate <= monthEnd) thisMonthPayAmount += remain;
    }

    let overdueInvCount = 0, overdueInvAmount = 0, thisMonthInvAmount = 0;
    for (const inv of invs) {
      if (inv.status !== "unpaid" && inv.status !== "partial") continue;
      const remain = parseNumeric(inv.totalAmount) - parseNumeric(inv.paidAmount ?? 0);
      if (remain <= 0) continue;
      if (inv.dueDate && inv.dueDate < today) { overdueInvCount++; overdueInvAmount += remain; }
      if (inv.dueDate && inv.dueDate >= monthStart && inv.dueDate <= monthEnd) thisMonthInvAmount += remain;
    }

    res.json({
      totalProjects, activeProjects, completedProjects,
      totalContractAmount, totalActualCost, averageGrossProfitRate,
      plannedGrossProfit,
      overduePayments: { count: overduePayCount, amount: overduePayAmount },
      overdueInvoices: { count: overdueInvCount, amount: overdueInvAmount },
      thisMonthPayments: thisMonthPayAmount,
      thisMonthInvoices: thisMonthInvAmount,
      recentProjects, alertProjects,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get dashboard overview");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/cost-by-category", async (req, res) => {
  try {
    const { projectId } = req.query as Record<string, string>;

    const conditions = projectId ? eq(costItemsTable.projectId, parseInt(projectId)) : undefined;
    const costItems = await db.select().from(costItemsTable).where(conditions);

    const totals: Record<string, number> = { material: 0, labor: 0, subcontract: 0, expense: 0 };
    for (const ci of costItems) {
      totals[ci.category] = (totals[ci.category] ?? 0) + parseNumeric(ci.amount);
    }

    const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);
    const categories = Object.entries(totals).map(([category, amount]) => ({
      category,
      label: categoryLabels[category] ?? category,
      amount,
      percentage: grandTotal > 0 ? Math.round((amount / grandTotal) * 1000) / 10 : 0,
    }));

    res.json({ categories });
  } catch (err) {
    logger.error({ err }, "Failed to get cost-by-category");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/monthly-costs", async (req, res) => {
  try {
    const { projectId, year } = req.query as Record<string, string>;
    // Default to year of most recent cost item if no year specified
    let targetYear = year ? parseInt(year) : new Date().getFullYear();
    if (!year) {
      const recentCostItems = await db.select({ incurredDate: costItemsTable.incurredDate })
        .from(costItemsTable)
        .orderBy(desc(costItemsTable.incurredDate))
        .limit(1);
      if (recentCostItems.length > 0) {
        targetYear = new Date(recentCostItems[0].incurredDate).getFullYear();
      }
    }

    const conditions = projectId ? eq(costItemsTable.projectId, parseInt(projectId)) : undefined;
    const costItems = await db.select().from(costItemsTable).where(conditions);

    const monthlyMap = new Map<string, { material: number; labor: number; subcontract: number; expense: number }>();

    for (let m = 1; m <= 12; m++) {
      const key = `${targetYear}-${String(m).padStart(2, "0")}`;
      monthlyMap.set(key, { material: 0, labor: 0, subcontract: 0, expense: 0 });
    }

    for (const ci of costItems) {
      const d = new Date(ci.incurredDate);
      if (d.getFullYear() !== targetYear) continue;
      const key = `${targetYear}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = monthlyMap.get(key);
      if (entry) {
        const cat = ci.category as keyof typeof entry;
        entry[cat] = (entry[cat] ?? 0) + parseNumeric(ci.amount);
      }
    }

    const months = Array.from(monthlyMap.entries()).map(([month, cats]) => ({
      month,
      ...cats,
      total: cats.material + cats.labor + cats.subcontract + cats.expense,
    }));

    res.json({ months });
  } catch (err) {
    logger.error({ err }, "Failed to get monthly-costs");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/budget-vs-actual", async (req, res) => {
  try {
    const { projectId } = req.query as Record<string, string>;
    const pid = projectId ? parseInt(projectId) : undefined;

    // 実行予算は budget_items(revisedBudget) にしか保存されず、区分(material/labor/…)を持たない。
    // 旧 budgets テーブルは未使用で常に空のため、合計ベースで「実行予算合計 vs 実績原価合計」を返す。
    // （工種別の内訳は実行予算画面の原価モニター、区分別の実績は原価明細タブで確認できる）
    const [budgetAgg, costAgg] = await Promise.all([
      db.select({ total: sql<string>`coalesce(sum(${budgetItemsTable.revisedBudget}), 0)` })
        .from(budgetItemsTable)
        .where(pid ? eq(budgetItemsTable.projectId, pid) : undefined),
      db.select({ total: sql<string>`coalesce(sum(${costItemsTable.amount}), 0)` })
        .from(costItemsTable)
        .where(pid ? eq(costItemsTable.projectId, pid) : undefined),
    ]);

    const budget = parseNumeric(budgetAgg[0]?.total);
    const actual = parseNumeric(costAgg[0]?.total);
    const variance = budget - actual;
    const usageRate = budget > 0 ? Math.round((actual / budget) * 1000) / 10 : 0;

    const items = [{ category: "total", label: "合計", budget, actual, variance, usageRate }];
    res.json({ items });
  } catch (err) {
    logger.error({ err }, "Failed to get budget-vs-actual");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
