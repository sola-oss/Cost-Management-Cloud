import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import {
  db,
  projectsTable,
  costItemsTable,
  budgetItemsTable,
  invoicesTable,
  estimatesTable,
  attendancesTable,
  attendanceRatesTable,
  craftsmenTable,
  vendorsTable,
  purchaseInvoicesTable,
  purchaseInvoiceItemsTable,
} from "@workspace/db";
import { crewOf } from "./attendances";
import { matchProvisionals, type MatchInvoice } from "../lib/cost-sheet-matching";
import { generateVoucherNumber, syncCostItemsAfterInvoice, deleteCostItemsByInvoiceId } from "../lib/purchase-invoice-create";
import { withUniqueNumberTransaction } from "../lib/unique-number";

const router: IRouter = Router();

// ─── 工事原価計算書（工事詳細の基本情報タブ）────────────────────────────────────
//
// 現場の人が慣れている Excel「工事原価計算書」と同じ並びで、工事1件の原価を月ごとに見せる。
//   労務費        … 出面（人工・早出・残業）× 工事ごとの単価
//   外注労務費    … 原価の区分 labor（常用など、業者から請求される人工）
//   外注費        … 区分 subcontract。実行予算の額（外注金額）と残高も出す
//   材料費        … 区分 material
//   損料・消耗品  … 区分 expense
// 業者からの原価は、確定原価（請求書）に加えて、まだ請求書の来ていない仮原価（納品書・マスに打った金額）も数える
// （2026-11-16 温品様の流れ：先に打っておき、請求書が来たらスキャンして確定）。仮は請求書と照合されると数えなくなる
// ので二重にはならない。照合は lib/cost-sheet-matching.ts。
// Excel 下段の消耗品費・諸経費・総合計も出す（2026-11-16 アイさん。10/29 に一度外したのを戻した）。
//   消耗品費 = 合計 × 率（既定3%）、諸経費 = (合計 + 消耗品費) × 率（既定10%）。どちらも円未満切り捨て（Excel の TRUNC）
//   実行金額 = 総合計、純利益 = 決定金額 − 総合計
export const DEFAULT_CONSUMABLE_RATE = 3;
export const DEFAULT_OVERHEAD_RATE = 10;

// 原価計算書のマスに打った金額でできた仮の伝票の目印（仕入入力の画面の備考にも出る）
export const SHEET_ENTRY_NOTE = "工事原価計算書から入力";
// 表の下の「材料の明細」に打った行でできた仮の伝票の目印。業者×日付で1枚（納品書1枚のイメージ）
export const DETAIL_NOTE = "工事原価計算書の明細から入力";
const DETAIL_CATEGORIES = ["material", "expense"] as const;
type DetailCategory = (typeof DETAIL_CATEGORIES)[number];

const parseN = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0);
const monthOf = (d: string | Date) => String(d instanceof Date ? d.toISOString() : d).slice(0, 7);

const SECTION_ORDER = ["labor", "subcontract", "material", "expense"] as const;
type Section = (typeof SECTION_ORDER)[number];

type VendorRow = {
  vendorId: number | null;
  name: string;
  byMonth: Record<string, number>;
  // byMonth のうち仮（請求書待ち）の分。画面で色を変える
  provByMonth: Record<string, number>;
  // 請求書で確定した分がある・照合の確認待ちがある月。その月のマスは直せない
  lockedMonths: string[];
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
          craftsmanId: attendancesTable.craftsmanId,
          name: craftsmenTable.name,
          month: sql<string>`to_char(${attendancesTable.workDate}, 'YYYY-MM')`,
          manDays: sql<string>`SUM(${attendancesTable.manDays})`,
          early: sql<string>`SUM(${attendancesTable.earlyCount})`,
          overtime: sql<string>`SUM(${attendancesTable.overtimeCount})`,
        })
        .from(attendancesTable)
        .leftJoin(craftsmenTable, eq(attendancesTable.craftsmanId, craftsmenTable.id))
        .where(eq(attendancesTable.projectId, projectId))
        .groupBy(attendancesTable.craftsmanId, craftsmenTable.name, sql`to_char(${attendancesTable.workDate}, 'YYYY-MM')`),
      db.select().from(attendanceRatesTable).where(eq(attendanceRatesTable.projectId, projectId)),
      db
        .select({
          category: costItemsTable.category,
          vendorId: costItemsTable.vendorId,
          vendorText: costItemsTable.vendor,
          vendorName: vendorsTable.name,
          incurredDate: costItemsTable.incurredDate,
          amount: costItemsTable.amount,
          stage: costItemsTable.stage,
          invoiceNumber: costItemsTable.invoiceNumber,
        })
        .from(costItemsTable)
        .leftJoin(vendorsTable, eq(costItemsTable.vendorId, vendorsTable.id))
        .where(and(eq(costItemsTable.projectId, projectId), inArray(costItemsTable.stage, ["provisional", "confirmed"]))),
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

    // 仮と請求書の照合。差のないものはここで確定にする（スキャンで請求書が入ったあと、最初に開いたとき）
    let invoices = await loadMatchInvoices(projectId);
    let matches = matchProvisionals(invoices);
    const auto = matches.filter((m) => m.status === "auto" && m.invoiceId != null);
    if (auto.length > 0) {
      for (const m of auto) {
        await db
          .update(purchaseInvoicesTable)
          .set({ settledByInvoiceId: m.invoiceId, updatedAt: new Date() })
          .where(inArray(purchaseInvoicesTable.id, m.provisionalIds));
      }
      invoices = await loadMatchInvoices(projectId);
      matches = matchProvisionals(invoices);
    }
    const invByVoucher = new Map(invoices.map((i) => [i.voucherNumber, i]));
    // 確認待ちの仮は、組になった請求書の金額を出すので表には数えない
    const hiddenProvIds = new Set(matches.filter((m) => m.status === "review").flatMap((m) => m.provisionalIds));
    const reviewKeys = new Set(matches.filter((m) => m.status === "review").flatMap((m) => [`${m.vendorId}:${m.month}`, `${m.vendorId}:${m.invoiceMonth}`]));

    // 材料費・損料等の明細（表の下）。上の表で数えているもの（確定＋請求書待ちの仮）の行を出す
    const detailRows = await db
      .select({
        itemId: purchaseInvoiceItemsTable.id,
        invoiceId: purchaseInvoiceItemsTable.purchaseInvoiceId,
        lineNumber: purchaseInvoiceItemsTable.lineNumber,
        category: purchaseInvoiceItemsTable.category,
        description: purchaseInvoiceItemsTable.description,
        specification: purchaseInvoiceItemsTable.specification,
        unit: purchaseInvoiceItemsTable.unit,
        quantity: purchaseInvoiceItemsTable.quantity,
        unitPrice: purchaseInvoiceItemsTable.unitPrice,
        amount: purchaseInvoiceItemsTable.amount,
      })
      .from(purchaseInvoiceItemsTable)
      .innerJoin(purchaseInvoicesTable, eq(purchaseInvoiceItemsTable.purchaseInvoiceId, purchaseInvoicesTable.id))
      .where(and(
        eq(purchaseInvoicesTable.projectId, projectId),
        ne(purchaseInvoicesTable.status, "cancelled"),
        inArray(purchaseInvoiceItemsTable.category, [...DETAIL_CATEGORIES]),
      ));
    const invById = new Map(invoices.map((i) => [i.id, i]));
    const purchaseDateById = new Map(
      (await db.select({ id: purchaseInvoicesTable.id, d: purchaseInvoicesTable.purchaseDate })
        .from(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.projectId, projectId))).map((r) => [r.id, String(r.d)]),
    );
    const details = Object.fromEntries(DETAIL_CATEGORIES.map((c) => [c, [] as unknown[]])) as Record<DetailCategory, unknown[]>;
    for (const d of detailRows) {
      const inv = invById.get(d.invoiceId);
      if (!inv) continue;
      if (inv.stage === "provisional" && (inv.settledByInvoiceId != null || hiddenProvIds.has(inv.id))) continue;
      if (inv.stage !== "provisional" && inv.stage !== "confirmed") continue;
      const editable = inv.stage === "provisional" && inv.notes === DETAIL_NOTE;
      details[d.category as DetailCategory].push({
        itemId: d.itemId,
        invoiceId: d.invoiceId,
        date: purchaseDateById.get(d.invoiceId) ?? "",
        vendorId: inv.vendorId,
        vendorName: inv.vendorName,
        description: d.description,
        specification: d.specification ?? "",
        unit: d.unit ?? "",
        quantity: parseN(d.quantity),
        unitPrice: parseN(d.unitPrice),
        amount: parseN(d.amount),
        stage: inv.stage,
        editable,
        sort: `${purchaseDateById.get(d.invoiceId)}|${String(d.invoiceId).padStart(9, "0")}|${String(d.lineNumber).padStart(4, "0")}`,
      });
    }
    for (const c of DETAIL_CATEGORIES) {
      (details[c] as { sort: string }[]).sort((a, b) => a.sort.localeCompare(b.sort));
    }

    const vendorList = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .orderBy(asc(vendorsTable.kana), asc(vendorsTable.name));

    const months = new Set<string>();
    // 工期の月も並べる（まだ何も入っていない月にも打てるように）
    if (project.startDate && project.endDate && project.startDate <= project.endDate) {
      months.add(monthOf(project.startDate));
      months.add(monthOf(project.endDate));
    }

    // 労務費（自社の職人）。単価が無い職人も行は出し、金額は0のまま単価を入れてもらう。
    // 「この現場の職人」に選んだ人は、出面がまだ無くても行を出す（Excel と同じ。2026-11-16）
    const rateBy = new Map(rateRows.map((r) => [r.craftsmanId, r]));
    type W = {
      craftsmanId: number;
      name: string;
      dayRate: number;
      overtimeRate: number;
      earlyRate: number;
      manDays: Record<string, number>;
      early: Record<string, number>;
      overtime: Record<string, number>;
    };
    const workers = new Map<number, W>();
    const newWorker = (craftsmanId: number, name: string): W => {
      const rate = rateBy.get(craftsmanId);
      return {
        craftsmanId,
        name,
        dayRate: parseN(rate?.dayRate),
        overtimeRate: parseN(rate?.overtimeRate),
        earlyRate: parseN(rate?.earlyRate),
        manDays: {},
        early: {},
        overtime: {},
      };
    };
    for (const c of await crewOf(projectId)) workers.set(c.id, newWorker(c.id, c.name));
    for (const r of attRows) {
      months.add(r.month);
      let w = workers.get(r.craftsmanId);
      if (!w) {
        w = newWorker(r.craftsmanId, r.name ?? "");
        workers.set(r.craftsmanId, w);
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
      });
    // 並びは「この現場の職人」で選んだ順のまま（打つたびに入れかわらないように）
    const laborTotal = labor.reduce((s, w) => s + w.amount, 0);

    // 業者からの原価を 区分 × 業者 × 月 に寄せる
    const sections: Record<Section, Map<string, VendorRow>> = {
      labor: new Map(),
      subcontract: new Map(),
      material: new Map(),
      expense: new Map(),
    };
    const keyOf = (vendorId: number | null, name: string) => (vendorId != null ? `v${vendorId}` : `n${name}`);
    const newRow = (vendorId: number | null, name: string): VendorRow =>
      ({ vendorId, name, byMonth: {}, provByMonth: {}, lockedMonths: [], total: 0, budget: null });
    for (const c of costRows) {
      const sec = sections[c.category as Section];
      if (!sec) continue;
      const isProv = c.stage === "provisional";
      const inv = c.invoiceNumber ? invByVoucher.get(c.invoiceNumber) : undefined;
      if (isProv) {
        // 伝票を通らない仮原価（原価明細で手入力）は照合できないので、この表には出さない
        if (!inv || inv.settledByInvoiceId != null || hiddenProvIds.has(inv.id)) continue;
      }
      const name = c.vendorName ?? c.vendorText ?? "（仕入先なし）";
      const k = keyOf(c.vendorId, name);
      let row = sec.get(k);
      if (!row) {
        row = newRow(c.vendorId, name);
        sec.set(k, row);
      }
      const m = monthOf(c.incurredDate);
      months.add(m);
      const amt = parseN(c.amount);
      row.byMonth[m] = (row.byMonth[m] ?? 0) + amt;
      if (isProv) row.provByMonth[m] = (row.provByMonth[m] ?? 0) + amt;
      // 請求書で確定した月と、下の明細に打ってある月は、上のマスでは打てない（明細の合計が入る。Excel と同じ）
      const lock = !isProv ? amt !== 0 : inv?.notes === DETAIL_NOTE;
      if (lock && !row.lockedMonths.includes(m)) row.lockedMonths.push(m);
      row.total += amt;
    }
    for (const sec of Object.values(sections)) {
      for (const row of sec.values()) {
        for (const m of months) {
          if (row.vendorId != null && reviewKeys.has(`${row.vendorId}:${m}`) && !row.lockedMonths.includes(m)) row.lockedMonths.push(m);
        }
      }
    }

    // 実行予算の額は、その業者の原価が出ている区分の行に付ける。まだ原価が無い業者は外注費に出す
    for (const b of budgetRows) {
      const name = b.supplierName || "（仕入先なし）";
      const k = keyOf(b.vendorId, name);
      const amount = parseN(b.total);
      const home = SECTION_ORDER.find((s) => sections[s].has(k)) ?? "subcontract";
      let row = sections[home].get(k);
      if (!row) {
        row = newRow(b.vendorId, name);
        sections[home].set(k, row);
      }
      row.budget = (row.budget ?? 0) + amount;
    }

    const sectionOut = Object.fromEntries(
      SECTION_ORDER.map((s) => {
        // 並びは仕入先の名前順で固定する（金額順だと、マスに打つたびに行が入れかわって打ちにくい）
        const rows = [...sections[s].values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
        return [s, { rows, total: rows.reduce((t, r) => t + r.total, 0) }];
      }),
    ) as Record<Section, { rows: VendorRow[]; total: number }>;

    const costTotal = laborTotal + SECTION_ORDER.reduce((t, s) => t + sectionOut[s].total, 0);
    const contractAmount = parseN(project.contractAmount);
    const grossProfit = contractAmount - costTotal;
    const consumableRate = project.consumableRate != null ? parseN(project.consumableRate) : DEFAULT_CONSUMABLE_RATE;
    const overheadRate = project.overheadRate != null ? parseN(project.overheadRate) : DEFAULT_OVERHEAD_RATE;
    const consumable = Math.trunc((costTotal * consumableRate) / 100);
    const overhead = Math.trunc(((costTotal + consumable) * overheadRate) / 100);
    const grandTotal = costTotal + consumable + overhead;
    const netProfit = contractAmount - grandTotal;

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
      vendors: vendorList,
      details,
      matches: matches.map(({ provisionalIds: _p, ...m }) => m),
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
        consumableRate,
        consumableRateIsDefault: project.consumableRate == null,
        consumable,
        overheadRate,
        overheadRateIsDefault: project.overheadRate == null,
        overhead,
        grandTotal,
        netProfit,
        netProfitRate: contractAmount > 0 ? Math.round((netProfit / contractAmount) * 1000) / 10 : null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to build cost sheet");
    return res.status(500).json({ message: "原価計算書の作成に失敗しました。" });
  }
});

type LoadedInvoice = MatchInvoice & { voucherNumber: string; notes: string | null };

async function loadMatchInvoices(projectId: number): Promise<LoadedInvoice[]> {
  const rows = await db
    .select({
      id: purchaseInvoicesTable.id,
      vendorId: purchaseInvoicesTable.vendorId,
      vendorName: vendorsTable.name,
      stage: purchaseInvoicesTable.stage,
      settledByInvoiceId: purchaseInvoicesTable.settledByInvoiceId,
      purchaseDate: purchaseInvoicesTable.purchaseDate,
      subtotal: purchaseInvoicesTable.subtotal,
      voucherNumber: purchaseInvoicesTable.voucherNumber,
      notes: purchaseInvoicesTable.notes,
    })
    .from(purchaseInvoicesTable)
    .leftJoin(vendorsTable, eq(purchaseInvoicesTable.vendorId, vendorsTable.id))
    .where(and(eq(purchaseInvoicesTable.projectId, projectId), ne(purchaseInvoicesTable.status, "cancelled")));
  return rows.map((r) => ({
    id: r.id,
    vendorId: r.vendorId,
    vendorName: r.vendorName ?? "",
    stage: r.stage,
    settledByInvoiceId: r.settledByInvoiceId,
    month: monthOf(r.purchaseDate),
    amount: parseN(r.subtotal),
    voucherNumber: r.voucherNumber,
    notes: r.notes,
  }));
}

const lastDayOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};

// PUT /api/cost-sheet/:projectId/cells — 業者×月のマスに金額を打つ（仮原価として入る）
//
// body: { category, vendorId, month: "YYYY-MM", amount }
// マスの金額 ＝ 確定（請求書）＋ 仮。請求書で確定した分があるマスは直せない。
// 打った金額から、ほかの仮（スキャンした納品書など）を引いた分を「原価計算書から入力」の仮の伝票1枚にまとめる。
// 0 にすると、その伝票を消す。
router.put("/:projectId/cells", async (req, res) => {
  try {
    const projectId = Number(req.params["projectId"]);
    const { category, month } = req.body ?? {};
    const vendorId = Number(req.body?.vendorId);
    const amount = Number(String(req.body?.amount ?? "").replace(/,/g, ""));
    if (!Number.isInteger(projectId) || projectId <= 0) return res.status(400).json({ message: "工事が正しくありません" });
    if (!SECTION_ORDER.includes(category)) return res.status(400).json({ message: "費目が正しくありません" });
    if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ message: "月が正しくありません" });
    if (!Number.isInteger(vendorId) || vendorId <= 0) return res.status(400).json({ message: "仕入先を選んでください" });
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ message: "金額は0以上の数で入れてください" });

    const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });
    const [vendor] = await db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable).where(eq(vendorsTable.id, vendorId));
    if (!vendor) return res.status(404).json({ message: "仕入先が見つかりません" });

    const from = `${month}-01`;
    const to = lastDayOf(month);
    const cellItems = await db
      .select({ amount: costItemsTable.amount, stage: costItemsTable.stage, invoiceNumber: costItemsTable.invoiceNumber })
      .from(costItemsTable)
      .where(and(
        eq(costItemsTable.projectId, projectId),
        eq(costItemsTable.vendorId, vendorId),
        eq(costItemsTable.category, category),
        gte(costItemsTable.incurredDate, from),
        lte(costItemsTable.incurredDate, to),
      ));
    if (cellItems.some((c) => c.stage === "confirmed" && parseN(c.amount) !== 0)) {
      return res.status(409).json({ message: "請求書で確定した月です。直すときは仕入入力の画面から直してください。" });
    }
    const invoices = await loadMatchInvoices(projectId);
    if (matchProvisionals(invoices).some((m) => m.status === "review" && m.vendorId === vendorId && (m.month === month || m.invoiceMonth === month))) {
      return res.status(409).json({ message: "請求書との照合が確認待ちの月です。先に下の一覧で確定してください。" });
    }
    const invByVoucher = new Map(invoices.map((i) => [i.voucherNumber, i]));
    if (cellItems.some((c) => c.stage === "provisional" && c.invoiceNumber && invByVoucher.get(c.invoiceNumber)?.notes === DETAIL_NOTE
      && invByVoucher.get(c.invoiceNumber)?.settledByInvoiceId == null)) {
      return res.status(409).json({ message: "この月は下の明細に打ってあります。明細の方で直してください。" });
    }
    const sheetInv = invoices.find((i) =>
      i.stage === "provisional" && i.settledByInvoiceId == null && i.notes === SHEET_ENTRY_NOTE &&
      i.vendorId === vendorId && i.month === month &&
      cellItems.some((c) => c.invoiceNumber === i.voucherNumber));
    // ほかの仮（請求書待ちのもの）はそのまま残し、打った金額との差だけをこの表の伝票に持たせる
    const others = cellItems
      .filter((c) => c.stage === "provisional" && c.invoiceNumber && c.invoiceNumber !== sheetInv?.voucherNumber)
      .filter((c) => {
        const inv = invByVoucher.get(c.invoiceNumber!);
        return inv && inv.settledByInvoiceId == null;
      })
      .reduce((s, c) => s + parseN(c.amount), 0);
    const sheetAmount = Math.round(amount - others);
    if (sheetAmount < 0) {
      return res.status(400).json({ message: `この月には納品書の分が ${others.toLocaleString("ja-JP")}円 入っているので、それより少なくはできません。` });
    }

    if (sheetInv) {
      await db.transaction(async (tx) => {
        if (sheetAmount === 0) {
          await deleteCostItemsByInvoiceId(tx, sheetInv.id);
          await tx.delete(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.id, sheetInv.id));
          return;
        }
        const items = await tx.select().from(purchaseInvoiceItemsTable).where(eq(purchaseInvoiceItemsTable.purchaseInvoiceId, sheetInv.id));
        const taxRate = items[0] ? parseN(items[0].taxRate) : 10;
        const tax = Math.floor((sheetAmount * taxRate) / 100);
        for (const [i, item] of items.entries()) {
          const a = i === 0 ? sheetAmount : 0;
          await tx.update(purchaseInvoiceItemsTable).set({ amount: String(a), unitPrice: String(a), quantity: "1" }).where(eq(purchaseInvoiceItemsTable.id, item.id));
          if (item.costItemId) {
            await tx.update(costItemsTable).set({ amount: String(a), unitPrice: String(a), quantity: "1", updatedAt: new Date() }).where(eq(costItemsTable.id, item.costItemId));
          }
        }
        await tx.update(purchaseInvoicesTable)
          .set({ subtotal: String(sheetAmount), taxAmount: String(tax), totalAmount: String(sheetAmount + tax), updatedAt: new Date() })
          .where(eq(purchaseInvoicesTable.id, sheetInv.id));
      });
    } else if (sheetAmount > 0) {
      const tax = Math.floor(sheetAmount / 10);
      const purchaseDate = lastDayOf(month);
      await withUniqueNumberTransaction(generateVoucherNumber, async (voucherNumber, tx) => {
        const [inv] = await tx.insert(purchaseInvoicesTable).values({
          voucherNumber,
          projectId,
          vendorId,
          purchaseDate,
          status: "provisional",
          // 支払査定に入らないようにする（請求書が来るまでは払わない）
          isProvisional: true,
          stage: "provisional",
          subtotal: String(sheetAmount),
          taxAmount: String(tax),
          totalAmount: String(sheetAmount + tax),
          notes: SHEET_ENTRY_NOTE,
        }).returning();
        const [mo] = month.split("-").slice(1).map(Number);
        const inserted = await tx.insert(purchaseInvoiceItemsTable).values({
          purchaseInvoiceId: inv.id,
          lineNumber: 1,
          category,
          description: `${mo}月分（工事原価計算書から入力）`,
          quantity: "1",
          unit: "式",
          unitPrice: String(sheetAmount),
          amount: String(sheetAmount),
          taxRate: "10",
        }).returning();
        await syncCostItemsAfterInvoice(tx, projectId, purchaseDate, voucherNumber, "provisional", vendor.name, vendorId, inserted);
        return inv;
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save cost sheet cell");
    return res.status(500).json({ message: "金額の保存に失敗しました。" });
  }
});

// ─── 材料・損料等の明細（表の下）──────────────────────────────────────────────
// Excel では下の明細に 日付・品名・色・容量・単価・数量 を打つと、月の合計が上の材料費のマスに入る。
// 同じく、明細の1行を仮の仕入伝票の1明細として持つ。伝票は 業者×日付 で1枚（DETAIL_NOTE の目印付き）。
// 請求書が来れば、上の表と同じく 業者×月 で照合して確定する。

type DetailInput = {
  category?: string;
  vendorId?: number;
  date?: string;
  description?: string;
  specification?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
};

function readDetail(b: DetailInput, partial: boolean): { ok: true; v: DetailInput } | { ok: false; message: string } {
  const v: DetailInput = {};
  if (b.category !== undefined || !partial) {
    if (!DETAIL_CATEGORIES.includes(b.category as DetailCategory)) return { ok: false, message: "費目が正しくありません" };
    v.category = b.category;
  }
  if (b.vendorId !== undefined || !partial) {
    const n = Number(b.vendorId);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, message: "仕入先を選んでください" };
    v.vendorId = n;
  }
  if (b.date !== undefined || !partial) {
    if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || Number.isNaN(Date.parse(b.date))) {
      return { ok: false, message: "日付が正しくありません" };
    }
    v.date = b.date;
  }
  for (const k of ["description", "specification", "unit"] as const) {
    if (b[k] !== undefined) v[k] = String(b[k] ?? "").trim();
  }
  if (!partial && !v.description) return { ok: false, message: "品名を入れてください" };
  if (partial && v.description !== undefined && !v.description) return { ok: false, message: "品名は空にできません" };
  for (const k of ["quantity", "unitPrice"] as const) {
    if (b[k] === undefined) continue;
    const n = Number(String(b[k]).replace(/,/g, ""));
    if (!Number.isFinite(n)) return { ok: false, message: "数量・単価は数で入れてください" };
    v[k] = n;
  }
  return { ok: true, v };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 伝票の合計を明細から計算し直す。明細が無くなった伝票は消す */
async function recomputeInvoice(tx: Tx, invoiceId: number) {
  const items = await tx.select().from(purchaseInvoiceItemsTable).where(eq(purchaseInvoiceItemsTable.purchaseInvoiceId, invoiceId));
  if (items.length === 0) {
    await tx.delete(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.id, invoiceId));
    return;
  }
  const subtotal = items.reduce((s, i) => s + parseN(i.amount), 0);
  const tax = items.reduce((s, i) => s + Math.floor((parseN(i.amount) * parseN(i.taxRate)) / 100), 0);
  await tx.update(purchaseInvoicesTable)
    .set({ subtotal: String(subtotal), taxAmount: String(tax), totalAmount: String(subtotal + tax), updatedAt: new Date() })
    .where(eq(purchaseInvoicesTable.id, invoiceId));
}

/** 上のマスに合計が打ってある（原価計算書から入力の仮がある）月には、明細を足せない（二重になるため） */
async function sheetEntryExists(projectId: number, vendorId: number, category: string, date: string) {
  const month = date.slice(0, 7);
  const invs = await loadMatchInvoices(projectId);
  const sheetVouchers = invs
    .filter((i) => i.notes === SHEET_ENTRY_NOTE && i.stage === "provisional" && i.settledByInvoiceId == null && i.vendorId === vendorId && i.month === month)
    .map((i) => i.voucherNumber);
  if (sheetVouchers.length === 0) return false;
  const rows = await db.select({ id: costItemsTable.id }).from(costItemsTable).where(and(
    eq(costItemsTable.projectId, projectId),
    eq(costItemsTable.category, category as DetailCategory),
    inArray(costItemsTable.invoiceNumber, sheetVouchers),
  ));
  return rows.length > 0;
}

/** 明細1行を、業者×日付の仮の伝票に足す（伝票が無ければ作る） */
async function addDetailLine(projectId: number, v: Required<Pick<DetailInput, "category" | "vendorId" | "date" | "description">> & DetailInput) {
  const [vendor] = await db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable).where(eq(vendorsTable.id, v.vendorId));
  if (!vendor) throw Object.assign(new Error("仕入先が見つかりません"), { status: 404 });
  const quantity = v.quantity ?? 1;
  const unitPrice = v.unitPrice ?? 0;
  const amount = Math.round(quantity * unitPrice);
  const [existing] = await db.select({ id: purchaseInvoicesTable.id, voucherNumber: purchaseInvoicesTable.voucherNumber })
    .from(purchaseInvoicesTable)
    .where(and(
      eq(purchaseInvoicesTable.projectId, projectId),
      eq(purchaseInvoicesTable.vendorId, v.vendorId),
      eq(purchaseInvoicesTable.purchaseDate, v.date),
      eq(purchaseInvoicesTable.stage, "provisional"),
      eq(purchaseInvoicesTable.notes, DETAIL_NOTE),
      sql`${purchaseInvoicesTable.settledByInvoiceId} IS NULL`,
    ))
    .limit(1);
  const item = {
    category: v.category as DetailCategory,
    description: v.description,
    specification: v.specification || null,
    quantity: String(quantity),
    unit: v.unit ?? "",
    unitPrice: String(unitPrice),
    amount: String(amount),
    taxRate: "10",
  };
  if (existing) {
    await db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`COALESCE(MAX(${purchaseInvoiceItemsTable.lineNumber}), 0)` })
        .from(purchaseInvoiceItemsTable).where(eq(purchaseInvoiceItemsTable.purchaseInvoiceId, existing.id));
      const inserted = await tx.insert(purchaseInvoiceItemsTable).values({ ...item, purchaseInvoiceId: existing.id, lineNumber: Number(n) + 1 }).returning();
      await syncCostItemsAfterInvoice(tx, projectId, v.date, existing.voucherNumber, "provisional", vendor.name, vendor.id, inserted);
      await recomputeInvoice(tx, existing.id);
    });
    return;
  }
  await withUniqueNumberTransaction(generateVoucherNumber, async (voucherNumber, tx) => {
    const [inv] = await tx.insert(purchaseInvoicesTable).values({
      voucherNumber,
      projectId,
      vendorId: vendor.id,
      purchaseDate: v.date,
      status: "provisional",
      isProvisional: true, // 請求書が来るまでは支払査定に入れない
      stage: "provisional",
      notes: DETAIL_NOTE,
    }).returning();
    const inserted = await tx.insert(purchaseInvoiceItemsTable).values({ ...item, purchaseInvoiceId: inv.id, lineNumber: 1 }).returning();
    await syncCostItemsAfterInvoice(tx, projectId, v.date, voucherNumber, "provisional", vendor.name, vendor.id, inserted);
    await recomputeInvoice(tx, inv.id);
    return inv;
  });
}

/** 直せる明細か（この工事の、明細から入力した、まだ請求書と照合していない仮の伝票の行） */
async function loadEditableLine(projectId: number, itemId: number) {
  const [row] = await db
    .select({ item: purchaseInvoiceItemsTable, inv: purchaseInvoicesTable })
    .from(purchaseInvoiceItemsTable)
    .innerJoin(purchaseInvoicesTable, eq(purchaseInvoiceItemsTable.purchaseInvoiceId, purchaseInvoicesTable.id))
    .where(eq(purchaseInvoiceItemsTable.id, itemId));
  if (!row || row.inv.projectId !== projectId) return { error: 404, message: "明細が見つかりません。画面を開き直してください。" } as const;
  if (row.inv.notes !== DETAIL_NOTE || row.inv.stage !== "provisional" || row.inv.settledByInvoiceId != null) {
    return { error: 409, message: "請求書で確定した明細は、ここでは直せません。" } as const;
  }
  return { row } as const;
}

async function removeLine(itemId: number, invoiceId: number, costItemId: number | null) {
  await db.transaction(async (tx) => {
    if (costItemId) await tx.delete(costItemsTable).where(eq(costItemsTable.id, costItemId));
    await tx.delete(purchaseInvoiceItemsTable).where(eq(purchaseInvoiceItemsTable.id, itemId));
    await recomputeInvoice(tx, invoiceId);
  });
}

// POST /api/cost-sheet/:projectId/detail-lines — 明細を1行足す
router.post("/:projectId/detail-lines", async (req, res) => {
  try {
    const projectId = Number(req.params["projectId"]);
    const r = readDetail(req.body ?? {}, false);
    if (!r.ok) return res.status(400).json({ message: r.message });
    const v = r.v as Required<Pick<DetailInput, "category" | "vendorId" | "date" | "description">> & DetailInput;
    if (await sheetEntryExists(projectId, v.vendorId, v.category, v.date)) {
      return res.status(409).json({ message: "この業者のこの月は、上のマスに合計が打ってあります。先に上のマスを空にしてから明細を打ってください。" });
    }
    await addDetailLine(projectId, v);
    return res.status(201).json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return res.status(status).json({ message: (err as Error).message });
    req.log.error({ err }, "Failed to add detail line");
    return res.status(500).json({ message: "明細の保存に失敗しました。" });
  }
});

// PUT /api/cost-sheet/:projectId/detail-lines/:itemId — 明細を直す（送られた欄だけ）
router.put("/:projectId/detail-lines/:itemId", async (req, res) => {
  try {
    const projectId = Number(req.params["projectId"]);
    const itemId = Number(req.params["itemId"]);
    const r = readDetail(req.body ?? {}, true);
    if (!r.ok) return res.status(400).json({ message: r.message });
    const loaded = await loadEditableLine(projectId, itemId);
    if ("error" in loaded) return res.status(loaded.error ?? 500).json({ message: loaded.message });
    const { item, inv } = loaded.row;
    const v = r.v;
    const vendorId = v.vendorId ?? inv.vendorId;
    const date = v.date ?? String(inv.purchaseDate);
    const merged = {
      category: (v.category ?? item.category) as DetailCategory,
      vendorId,
      date,
      description: v.description ?? item.description,
      specification: v.specification ?? item.specification ?? "",
      unit: v.unit ?? item.unit ?? "",
      quantity: v.quantity ?? parseN(item.quantity),
      unitPrice: v.unitPrice ?? parseN(item.unitPrice),
    };
    // 業者・日付・費目が変わったら、別の伝票（業者×日付）へ移す
    if (vendorId !== inv.vendorId || date !== String(inv.purchaseDate) || merged.category !== item.category) {
      if (await sheetEntryExists(projectId, vendorId, merged.category, date)) {
        return res.status(409).json({ message: "その業者のその月は、上のマスに合計が打ってあります。先に上のマスを空にしてください。" });
      }
      await removeLine(item.id, inv.id, item.costItemId);
      await addDetailLine(projectId, merged);
      return res.json({ ok: true });
    }
    const amount = Math.round(merged.quantity * merged.unitPrice);
    await db.transaction(async (tx) => {
      const values = {
        description: merged.description,
        specification: merged.specification || null,
        unit: merged.unit,
        quantity: String(merged.quantity),
        unitPrice: String(merged.unitPrice),
        amount: String(amount),
      };
      await tx.update(purchaseInvoiceItemsTable).set(values).where(eq(purchaseInvoiceItemsTable.id, item.id));
      if (item.costItemId) {
        await tx.update(costItemsTable).set({
          description: values.description, unit: values.unit, quantity: values.quantity,
          unitPrice: values.unitPrice, amount: values.amount, updatedAt: new Date(),
        }).where(eq(costItemsTable.id, item.costItemId));
      }
      await recomputeInvoice(tx, inv.id);
    });
    return res.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) return res.status(status).json({ message: (err as Error).message });
    req.log.error({ err }, "Failed to update detail line");
    return res.status(500).json({ message: "明細の保存に失敗しました。" });
  }
});

// DELETE /api/cost-sheet/:projectId/detail-lines/:itemId — 明細を消す
router.delete("/:projectId/detail-lines/:itemId", async (req, res) => {
  try {
    const projectId = Number(req.params["projectId"]);
    const loaded = await loadEditableLine(projectId, Number(req.params["itemId"]));
    if ("error" in loaded) return res.status(loaded.error ?? 500).json({ message: loaded.message });
    await removeLine(loaded.row.item.id, loaded.row.inv.id, loaded.row.item.costItemId);
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete detail line");
    return res.status(500).json({ message: "明細の削除に失敗しました。" });
  }
});

// POST /api/cost-sheet/:projectId/settle — 確認待ち（仮と請求書の金額が違う）を確定する
// body: { vendorId, month }  month は仮の月。原価は請求書の金額になる
router.post("/:projectId/settle", async (req, res) => {
  try {
    const projectId = Number(req.params["projectId"]);
    const vendorId = Number(req.body?.vendorId);
    const month = String(req.body?.month ?? "");
    const row = matchProvisionals(await loadMatchInvoices(projectId))
      .find((m) => m.status === "review" && m.vendorId === vendorId && m.month === month);
    if (!row || row.invoiceId == null) return res.status(404).json({ message: "確認待ちのものが見つかりません。画面を開き直してください。" });
    await db
      .update(purchaseInvoicesTable)
      .set({ settledByInvoiceId: row.invoiceId, updatedAt: new Date() })
      .where(inArray(purchaseInvoicesTable.id, row.provisionalIds));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to settle cost sheet match");
    return res.status(500).json({ message: "確定に失敗しました。" });
  }
});

// POST /api/cost-sheet/:projectId/vendors — 仕入先をその場で登録する（「＋ 仕入先を足す」に無いとき）
// body: { name, kana? }  名前だけで作り、振込先などは事務が仕入先マスタで足す。同じ名前があればそれを返す
router.post("/:projectId/vendors", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const kana = String(req.body?.kana ?? "").trim();
    if (!name) return res.status(400).json({ message: "仕入先の名前を入れてください" });
    const [same] = await db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable).where(eq(vendorsTable.name, name));
    if (same) return res.json({ ...same, existed: true });
    const [row] = await db
      .insert(vendorsTable)
      .values({ name, kana: kana || null, notes: "工事原価計算書から登録（振込先などは未入力）" })
      .returning({ id: vendorsTable.id, name: vendorsTable.name });
    return res.status(201).json({ ...row, existed: false });
  } catch (err) {
    req.log.error({ err }, "Failed to create vendor from cost sheet");
    return res.status(500).json({ message: "仕入先の登録に失敗しました。" });
  }
});

// PUT /api/cost-sheet/:projectId/overhead-rates — 消耗品費・諸経費の率（%）。送られた方だけ直す。空なら既定に戻す
router.put("/:projectId/overhead-rates", async (req, res) => {
  try {
    const projectId = Number(req.params["projectId"]);
    if (!Number.isInteger(projectId) || projectId <= 0) return res.status(400).json({ message: "工事が正しくありません" });
    const set: { consumableRate?: string | null; overheadRate?: string | null } = {};
    for (const k of ["consumableRate", "overheadRate"] as const) {
      const v = req.body?.[k];
      if (v === undefined) continue;
      if (v === null || v === "") {
        set[k] = null;
        continue;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ message: "率は0〜100の数で入れてください" });
      set[k] = String(n);
    }
    if (Object.keys(set).length === 0) return res.status(400).json({ message: "率がありません" });
    const [row] = await db.update(projectsTable).set({ ...set, updatedAt: new Date() }).where(eq(projectsTable.id, projectId)).returning({ id: projectsTable.id });
    if (!row) return res.status(404).json({ message: "工事が見つかりません" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save overhead rates");
    return res.status(500).json({ message: "率の保存に失敗しました。" });
  }
});

// PUT /api/cost-sheet/:projectId/rates/:craftsmanId — 職人の単価（工事ごと）
router.put("/:projectId/rates/:craftsmanId", async (req, res) => {
  try {
    const projectId = Number(req.params["projectId"]);
    const craftsmanId = Number(req.params["craftsmanId"]);
    if (!Number.isInteger(projectId) || !Number.isInteger(craftsmanId)) {
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
      .values({ projectId, craftsmanId, ...values })
      .onConflictDoUpdate({
        target: [attendanceRatesTable.projectId, attendanceRatesTable.craftsmanId],
        set: { ...values, updatedAt: new Date() },
      });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save attendance rate");
    return res.status(500).json({ message: "単価の保存に失敗しました。" });
  }
});

export default router;
