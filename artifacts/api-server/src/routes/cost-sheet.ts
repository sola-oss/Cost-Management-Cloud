import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  projectsTable,
  costItemsTable,
  budgetItemsTable,
  invoicesTable,
  estimatesTable,
  attendancesTable,
  attendanceRatesTable,
  staffMembersTable,
  vendorsTable,
} from "@workspace/db";
import { confirmedCostOnly } from "../lib/cost-stage";

const router: IRouter = Router();

// ─── 工事原価計算書（工事詳細の基本情報タブ）────────────────────────────────────
//
// 現場の人が慣れている Excel「工事原価計算書」と同じ並びで、工事1件の原価を月ごとに見せる。
//   労務費        … 出面（人工・早出・残業）× 工事ごとの単価
//   外注労務費    … 原価の区分 labor（常用など、業者から請求される人工）
//   外注費        … 区分 subcontract。実行予算の額（外注金額）と残高も出す
//   材料費        … 区分 material
//   損料・消耗品  … 区分 expense
// 業者からの原価は確定原価だけを数える（他の画面の集計と同じ）。
// Excel 下段の消耗品費3%・諸経費10% は出さない（アイさん判断 2026-10-29）。

const parseN = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0);
const monthOf = (d: string | Date) => String(d instanceof Date ? d.toISOString() : d).slice(0, 7);

const SECTION_ORDER = ["labor", "subcontract", "material", "expense"] as const;
type Section = (typeof SECTION_ORDER)[number];

type VendorRow = {
  vendorId: number | null;
  name: string;
  byMonth: Record<string, number>;
  total: number;
  // 実行予算の額（外注金額）。無ければ null
  budget: number | null;
};

// GET /api/cost-sheet/:projectId
router.get("/:projectId", async (req, res) => {
  try {
    const projectId = Number(req.params["projectId"]);
    if (!Number.isInteger(projectId) || projectId <= 0) return res.status(400).json({ message: "工事が正しくありません" });
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    const [attRows, rateRows, costRows, budgetRows, invoiceRows, estimateRows] = await Promise.all([
      db
        .select({
          staffMemberId: attendancesTable.staffMemberId,
          name: staffMembersTable.name,
          month: sql<string>`to_char(${attendancesTable.workDate}, 'YYYY-MM')`,
          manDays: sql<string>`SUM(${attendancesTable.manDays})`,
          early: sql<string>`SUM(${attendancesTable.earlyCount})`,
          overtime: sql<string>`SUM(${attendancesTable.overtimeCount})`,
        })
        .from(attendancesTable)
        .leftJoin(staffMembersTable, eq(attendancesTable.staffMemberId, staffMembersTable.id))
        .where(eq(attendancesTable.projectId, projectId))
        .groupBy(attendancesTable.staffMemberId, staffMembersTable.name, sql`to_char(${attendancesTable.workDate}, 'YYYY-MM')`),
      db.select().from(attendanceRatesTable).where(eq(attendanceRatesTable.projectId, projectId)),
      db
        .select({
          category: costItemsTable.category,
          vendorId: costItemsTable.vendorId,
          vendorText: costItemsTable.vendor,
          vendorName: vendorsTable.name,
          incurredDate: costItemsTable.incurredDate,
          amount: costItemsTable.amount,
        })
        .from(costItemsTable)
        .leftJoin(vendorsTable, eq(costItemsTable.vendorId, vendorsTable.id))
        .where(and(eq(costItemsTable.projectId, projectId), confirmedCostOnly)),
      db
        .select({
          vendorId: budgetItemsTable.vendorId,
          supplierName: budgetItemsTable.supplierName,
          total: sql<string>`SUM(${budgetItemsTable.revisedBudget})`,
        })
        .from(budgetItemsTable)
        .where(eq(budgetItemsTable.projectId, projectId))
        .groupBy(budgetItemsTable.vendorId, budgetItemsTable.supplierName),
      db.select({ total: invoicesTable.totalAmount }).from(invoicesTable).where(eq(invoicesTable.projectId, projectId)),
      db
        .select({ total: estimatesTable.taxIncludedAmount })
        .from(estimatesTable)
        .where(eq(estimatesTable.projectId, projectId))
        .orderBy(desc(estimatesTable.id))
        .limit(1),
    ]);

    const months = new Set<string>();

    // 労務費（自社の職人）。単価が無い職人も行は出し、金額は0のまま単価を入れてもらう
    const rateBy = new Map(rateRows.map((r) => [r.staffMemberId, r]));
    const workers = new Map<number, {
      staffMemberId: number;
      name: string;
      dayRate: number;
      overtimeRate: number;
      earlyRate: number;
      manDays: Record<string, number>;
      early: Record<string, number>;
      overtime: Record<string, number>;
    }>();
    for (const r of attRows) {
      months.add(r.month);
      let w = workers.get(r.staffMemberId);
      if (!w) {
        const rate = rateBy.get(r.staffMemberId);
        w = {
          staffMemberId: r.staffMemberId,
          name: r.name ?? "",
          dayRate: parseN(rate?.dayRate),
          overtimeRate: parseN(rate?.overtimeRate),
          earlyRate: parseN(rate?.earlyRate),
          manDays: {},
          early: {},
          overtime: {},
        };
        workers.set(r.staffMemberId, w);
      }
      w.manDays[r.month] = parseN(r.manDays);
      w.early[r.month] = parseN(r.early);
      w.overtime[r.month] = parseN(r.overtime);
    }
    const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
    const labor = [...workers.values()]
      .map((w) => {
        const manDaysTotal = sum(w.manDays);
        const earlyTotal = sum(w.early);
        const overtimeTotal = sum(w.overtime);
        return {
          ...w,
          manDaysTotal,
          earlyTotal,
          overtimeTotal,
          amount: manDaysTotal * w.dayRate + earlyTotal * w.earlyRate + overtimeTotal * w.overtimeRate,
        };
      })
      .sort((a, b) => b.manDaysTotal - a.manDaysTotal);
    const laborTotal = labor.reduce((s, w) => s + w.amount, 0);

    // 業者からの原価を 区分 × 業者 × 月 に寄せる
    const sections: Record<Section, Map<string, VendorRow>> = {
      labor: new Map(),
      subcontract: new Map(),
      material: new Map(),
      expense: new Map(),
    };
    const keyOf = (vendorId: number | null, name: string) => (vendorId != null ? `v${vendorId}` : `n${name}`);
    for (const c of costRows) {
      const sec = sections[c.category as Section];
      if (!sec) continue;
      const name = c.vendorName ?? c.vendorText ?? "（仕入先なし）";
      const k = keyOf(c.vendorId, name);
      let row = sec.get(k);
      if (!row) {
        row = { vendorId: c.vendorId, name, byMonth: {}, total: 0, budget: null };
        sec.set(k, row);
      }
      const m = monthOf(c.incurredDate);
      months.add(m);
      const amt = parseN(c.amount);
      row.byMonth[m] = (row.byMonth[m] ?? 0) + amt;
      row.total += amt;
    }

    // 実行予算の額は、その業者の原価が出ている区分の行に付ける。まだ原価が無い業者は外注費に出す
    for (const b of budgetRows) {
      const name = b.supplierName || "（仕入先なし）";
      const k = keyOf(b.vendorId, name);
      const amount = parseN(b.total);
      const home = SECTION_ORDER.find((s) => sections[s].has(k)) ?? "subcontract";
      let row = sections[home].get(k);
      if (!row) {
        row = { vendorId: b.vendorId, name, byMonth: {}, total: 0, budget: null };
        sections[home].set(k, row);
      }
      row.budget = (row.budget ?? 0) + amount;
    }

    const sectionOut = Object.fromEntries(
      SECTION_ORDER.map((s) => {
        const rows = [...sections[s].values()].sort((a, b) => b.total - a.total || (b.budget ?? 0) - (a.budget ?? 0));
        return [s, { rows, total: rows.reduce((t, r) => t + r.total, 0) }];
      }),
    ) as Record<Section, { rows: VendorRow[]; total: number }>;

    const costTotal = laborTotal + SECTION_ORDER.reduce((t, s) => t + sectionOut[s].total, 0);
    const contractAmount = parseN(project.contractAmount);
    const grossProfit = contractAmount - costTotal;

    return res.json({
      project: {
        id: project.id,
        name: project.name,
        projectCode: project.projectCode,
        clientName: project.clientName,
        siteManager: project.siteManager,
        location: project.location,
        startDate: project.startDate,
        endDate: project.endDate,
      },
      months: [...months].sort(),
      labor: { rows: labor, total: laborTotal },
      sections: sectionOut,
      summary: {
        costTotal,
        laborTotal,
        materialTotal: sectionOut.material.total,
        contractAmount,
        estimateAmount: estimateRows[0] ? parseN(estimateRows[0].total) : null,
        invoicedAmount: invoiceRows.reduce((s, i) => s + parseN(i.total), 0),
        grossProfit,
        grossProfitRate: contractAmount > 0 ? Math.round((grossProfit / contractAmount) * 1000) / 10 : null,
        laborRate: costTotal > 0 ? Math.round((laborTotal / costTotal) * 1000) / 10 : null,
        materialRate: costTotal > 0 ? Math.round((sectionOut.material.total / costTotal) * 1000) / 10 : null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to build cost sheet");
    return res.status(500).json({ message: "原価計算書の作成に失敗しました。" });
  }
});

// PUT /api/cost-sheet/:projectId/rates/:staffMemberId — 職人の単価（工事ごと）
router.put("/:projectId/rates/:staffMemberId", async (req, res) => {
  try {
    const projectId = Number(req.params["projectId"]);
    const staffMemberId = Number(req.params["staffMemberId"]);
    if (!Number.isInteger(projectId) || !Number.isInteger(staffMemberId)) {
      return res.status(400).json({ message: "工事・職人が正しくありません" });
    }
    // 送られてきた欄だけを直す。単価・残業・早出を続けて入れたとき、先の保存を古い値で消さないように
    const values: Partial<Record<"dayRate" | "overtimeRate" | "earlyRate", string>> = {};
    for (const k of ["dayRate", "overtimeRate", "earlyRate"] as const) {
      if (req.body?.[k] === undefined) continue;
      const n = Number(req.body[k]);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: "単価は0以上の数で入れてください" });
      values[k] = String(n);
    }
    if (Object.keys(values).length === 0) return res.status(400).json({ message: "単価がありません" });
    await db
      .insert(attendanceRatesTable)
      .values({ projectId, staffMemberId, ...values })
      .onConflictDoUpdate({
        target: [attendanceRatesTable.projectId, attendanceRatesTable.staffMemberId],
        set: { ...values, updatedAt: new Date() },
      });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save attendance rate");
    return res.status(500).json({ message: "単価の保存に失敗しました。" });
  }
});

export default router;
