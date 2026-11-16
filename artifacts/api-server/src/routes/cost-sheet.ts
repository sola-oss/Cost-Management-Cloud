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
// Excel 下段の消耗品費3%・諸経費10% は出さない（アイさん判断 2026-10-29）。

// 原価計算書のマスに打った金額でできた仮の伝票の目印（仕入入力の画面の備考にも出る）
export const SHEET_ENTRY_NOTE = "工事原価計算書から入力";

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
      if (isProv) {
        // 伝票を通らない仮原価（原価明細で手入力）は照合できないので、この表には出さない
        const inv = c.invoiceNumber ? invByVoucher.get(c.invoiceNumber) : undefined;
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
      else if (amt !== 0 && !row.lockedMonths.includes(m)) row.lockedMonths.push(m);
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
