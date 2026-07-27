import { Router, type IRouter } from "express";
import { eq, inArray, sql, desc, and, ne } from "drizzle-orm";
import {
  db,
  projectsTable,
  budgetItemsTable,
  costItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  projectProgressRecordsTable,
  receivedInvoicesTable,
} from "@workspace/db";

const router: IRouter = Router();

function num(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) || 0 : ((v as number) ?? 0);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── 社長ダッシュボード ──────────────────────────────────────────────────────
//
// 社長が知りたいのは「今いくら」ではなく「このあとどうなるか」。
// そのため、実績だけでなく着地見込みと危険信号を返す。
//
//  ・着地見込みは2本：予算どおりに終わった場合と、今のペースで進んだ場合
//  ・進捗率と原価消化率のズレ（進捗40%で原価60%なら赤信号）
//  ・未請求の発注残（発注済だが未納品＝これが見えないと粗利を楽観視する）
//  ・データの鮮度（数字を信じてよいかの判断材料）

router.get("/", async (req, res) => {
  try {
    // 施工中の工事を対象にする（完成工事は振り返り用で別軸）
    const projects = await db
      .select()
      .from(projectsTable)
      .where(ne(projectsTable.status, "completed"))
      .orderBy(desc(projectsTable.createdAt));

    const ids = projects.map((p) => p.id);
    if (ids.length === 0) {
      return res.json({
        summary: { contractTotal: 0, budgetTotal: 0, actualCostTotal: 0, plannedProfit: 0, plannedProfitRate: null, forecastProfit: null, forecastProfitRate: null, unbilledOrderTotal: 0 },
        alerts: [], projects: [], freshness: { projectsWithoutProgress: 0, staleProgressProjects: 0, pendingReceivedInvoices: 0, lastCostAt: null },
      });
    }

    const [budgetRows, costRows, orderRows, progressRows, lastCostRow, pendingInvRow] = await Promise.all([
      db.select({ projectId: budgetItemsTable.projectId, total: sql<string>`SUM(${budgetItemsTable.revisedBudget})` })
        .from(budgetItemsTable).where(inArray(budgetItemsTable.projectId, ids)).groupBy(budgetItemsTable.projectId),

      db.select({ projectId: costItemsTable.projectId, total: sql<string>`SUM(${costItemsTable.amount})` })
        .from(costItemsTable).where(inArray(costItemsTable.projectId, ids)).groupBy(costItemsTable.projectId),

      // 未請求の発注残：発注済み（下書き・キャンセル除く）の未納品分
      db.select({
          projectId: purchaseOrdersTable.projectId,
          remaining: sql<string>`SUM(GREATEST(${purchaseOrderItemsTable.quantity} - ${purchaseOrderItemsTable.deliveredQuantity}, 0) * ${purchaseOrderItemsTable.unitPrice})`,
        })
        .from(purchaseOrderItemsTable)
        .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.purchaseOrderId, purchaseOrdersTable.id))
        .where(and(
          inArray(purchaseOrdersTable.projectId, ids),
          inArray(purchaseOrdersTable.status, ["ordered", "partial"]),
        ))
        .groupBy(purchaseOrdersTable.projectId),

      db.select().from(projectProgressRecordsTable)
        .where(inArray(projectProgressRecordsTable.projectId, ids))
        .orderBy(desc(projectProgressRecordsTable.yearMonth)),

      db.select({ last: sql<string>`MAX(${costItemsTable.incurredDate})` }).from(costItemsTable),

      db.select({ c: sql<number>`COUNT(*)` }).from(receivedInvoicesTable)
        .where(inArray(receivedInvoicesTable.status, ["sent", "answered"])),
    ]);

    const budgetMap = new Map(budgetRows.map((r) => [r.projectId, num(r.total)]));
    const costMap = new Map(costRows.map((r) => [r.projectId, num(r.total)]));
    const orderMap = new Map(orderRows.map((r) => [r.projectId, num(r.remaining)]));

    // 各工事の最新の進捗記録
    const latestProgress = new Map<number, { rate: number; yearMonth: string }>();
    for (const r of progressRows) {
      if (!latestProgress.has(r.projectId)) {
        latestProgress.set(r.projectId, { rate: r.progressRate, yearMonth: r.yearMonth });
      }
    }

    const now = new Date();
    const thisYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevYm = (() => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();

    const items = projects.map((p) => {
      const contract = num(p.contractAmount);
      const budget = budgetMap.get(p.id) ?? 0;
      const actual = costMap.get(p.id) ?? 0;
      const unbilledOrder = orderMap.get(p.id) ?? 0;
      const prog = latestProgress.get(p.id) ?? null;
      // 履歴が無い工事は projects.progress_rate（旧来の単一値）を使う
      const progressRate = prog?.rate ?? p.progressRate ?? null;
      const costRate = budget > 0 ? (actual / budget) * 100 : null;

      // 予定粗利：請負 − 実行予算
      const plannedProfit = budget > 0 ? contract - budget : null;

      // 着地見込み（今のペース）：請負 −（実績原価 ÷ 進捗率）
      // ただし実績原価がほとんど計上されていない段階では、この式は極端に楽観的な
      // 数字になる（例：出来高40%・原価消化1% → 粗利99%）。月初など請求書が
      // まだ届いていない時期に必ず起きるので、実績が薄いうちは算出しない。
      const MIN_COST_RATE_FOR_FORECAST = 5; // 原価消化率がこれ未満なら見込みを出さない
      const enoughCost = costRate != null && costRate >= MIN_COST_RATE_FOR_FORECAST;
      const canForecast = !!progressRate && progressRate > 0 && enoughCost;
      const forecastCost = canForecast ? Math.round((actual / progressRate!) * 100) : null;
      const forecastProfit = forecastCost != null && contract > 0 ? contract - forecastCost : null;
      // 見込みを出せない理由（画面で「—」の意味を説明するため）
      const forecastUnavailableReason =
        !progressRate || progressRate <= 0 ? "出来高が未入力"
        : !enoughCost ? "実績原価がまだ少ない"
        : null;

      // 原価が進捗より何ポイント先行しているか（プラスが大きいほど危険）
      const gap = costRate != null && progressRate != null ? round1(costRate - progressRate) : null;

      return {
        id: p.id,
        projectCode: p.projectCode,
        name: p.name,
        clientName: p.clientName,
        siteManager: p.siteManager,
        contractAmount: contract,
        totalBudget: budget,
        totalActualCost: actual,
        budgetRemaining: budget - actual,
        unbilledOrder,
        progressRate,
        progressYearMonth: prog?.yearMonth ?? null,
        costConsumptionRate: costRate != null ? round1(costRate) : null,
        gap,
        plannedProfit,
        plannedProfitRate: plannedProfit != null && contract > 0 ? round1((plannedProfit / contract) * 100) : null,
        forecastCost,
        forecastProfit,
        forecastUnavailableReason,
        forecastProfitRate: forecastProfit != null && contract > 0 ? round1((forecastProfit / contract) * 100) : null,
        overBudget: budget > 0 && actual > budget,
      };
    });

    // ── 全体 ────────────────────────────────────────────────────────────────
    const contractTotal = items.reduce((s, i) => s + i.contractAmount, 0);
    const budgetTotal = items.reduce((s, i) => s + i.totalBudget, 0);
    const actualCostTotal = items.reduce((s, i) => s + i.totalActualCost, 0);
    const unbilledOrderTotal = items.reduce((s, i) => s + i.unbilledOrder, 0);
    const plannedProfit = contractTotal - budgetTotal;

    // 全体の着地見込みは、見込みが出せる工事だけを合計する（出せない工事は予定値で代替）
    const forecastProfit = Math.round(items.reduce((s, i) => s + (i.forecastProfit ?? i.plannedProfit ?? 0), 0));

    // ── 注意が要る工事（危ない順）─────────────────────────────────────────
    const alerts = items
      .map((i) => {
        const reasons: string[] = [];
        if (i.overBudget) reasons.push("予算超過");
        if (i.gap != null && i.gap >= 15) reasons.push(`原価が進捗より${i.gap}ポイント先行`);
        if (i.forecastProfitRate != null && i.forecastProfitRate < 0) reasons.push("着地見込みが赤字");
        // 深刻度：予算超過と赤字見込みを重く見る
        const severity =
          (i.overBudget ? 100 : 0) +
          (i.forecastProfitRate != null && i.forecastProfitRate < 0 ? 80 : 0) +
          (i.gap != null && i.gap > 0 ? i.gap : 0);
        return { ...i, reasons, severity };
      })
      .filter((i) => i.reasons.length > 0)
      .sort((a, b) => b.severity - a.severity);

    // ── データの鮮度（数字を信じてよいかの判断材料）───────────────────────
    const projectsWithoutProgress = items.filter((i) => i.progressRate == null).length;
    const staleProgressProjects = items.filter(
      (i) => i.progressYearMonth != null && i.progressYearMonth < prevYm,
    ).length;

    return res.json({
      summary: {
        contractTotal,
        budgetTotal,
        actualCostTotal,
        unbilledOrderTotal,
        plannedProfit,
        plannedProfitRate: contractTotal > 0 ? round1((plannedProfit / contractTotal) * 100) : null,
        forecastProfit,
        forecastProfitRate: contractTotal > 0 ? round1((forecastProfit / contractTotal) * 100) : null,
        activeProjects: items.length,
      },
      alerts: alerts.slice(0, 10),
      projects: items,
      freshness: {
        projectsWithoutProgress,
        staleProgressProjects,
        pendingReceivedInvoices: Number(pendingInvRow[0]?.c ?? 0),
        lastCostAt: lastCostRow[0]?.last ?? null,
        thisYearMonth: thisYm,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to build executive dashboard");
    return res.status(500).json({ message: "経営ダッシュボードの取得に失敗しました。" });
  }
});

export default router;
