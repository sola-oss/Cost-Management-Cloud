import { Router, type IRouter } from "express";
import { and, eq, gte, lte, ne, isNull, inArray } from "drizzle-orm";
import {
  db,
  purchaseInvoicesTable,
  purchaseInvoiceItemsTable,
  paymentsTable,
  projectsTable,
  vendorsTable,
} from "@workspace/db";

const router: IRouter = Router();

interface ProjectBreakdown {
  projectId: number;
  projectCode: string;
  projectName: string;
  amount: number;
  costItemIds: number[];
}

/**
 * Each row in the response: when assessmentType="vendor", the row represents
 * a single vendor's total, and projectBreakdowns holds the per-project split
 * needed when creating payments (which require projectId).
 */
interface AssessmentResultItem {
  vendor: string;
  projectId: number;
  projectCode: string;
  projectName: string;
  workType?: string;
  totalAmount: number;
  holdAmount: number;
  payAmount: number;
  costItemIds: number[];
  /** Only populated in vendor-only mode: per-project breakdown for confirm step */
  projectBreakdowns?: ProjectBreakdown[];
}

function parseNum(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : ((val as number) ?? 0);
}

function getMonthEndDate(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

function getClosingDate(year: number, month: number, closingDay: number): Date {
  if (closingDay === 99) {
    return getMonthEndDate(year, month);
  }
  return new Date(year, month, closingDay);
}

function applyClosingDay(
  startDate: string,
  endDate: string,
  closingDay: number
): { effectiveStart: string; effectiveEnd: string } {
  const startParsed = new Date(startDate);
  const endParsed = new Date(endDate);

  const startYear = startParsed.getFullYear();
  const startMonth = startParsed.getMonth();
  const endYear = endParsed.getFullYear();
  const endMonth = endParsed.getMonth();

  const refCloseDay =
    closingDay === 99
      ? getMonthEndDate(startYear, startMonth).getDate()
      : closingDay;

  let periodStart: Date;
  if (startParsed.getDate() <= refCloseDay) {
    const prevMonth = startMonth === 0 ? 11 : startMonth - 1;
    const prevYear = startMonth === 0 ? startYear - 1 : startYear;
    const prevClose = getClosingDate(prevYear, prevMonth, closingDay);
    prevClose.setDate(prevClose.getDate() + 1);
    periodStart = prevClose;
  } else {
    const curClose = getClosingDate(startYear, startMonth, closingDay);
    curClose.setDate(curClose.getDate() + 1);
    periodStart = curClose;
  }

  const periodEnd = getClosingDate(endYear, endMonth, closingDay);

  return {
    effectiveStart: periodStart.toISOString().split("T")[0],
    effectiveEnd: periodEnd.toISOString().split("T")[0],
  };
}

/**
 * POST /api/payment-assessments/calculate
 */
router.post("/calculate", async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      groupId,
      assessmentType = "vendor",
      closingDay,
      includeAssessed = false,
    } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "startDate, endDate は必須です" });
    }

    const validTypes = ["vendor", "vendor_project", "vendor_project_worktype"];
    if (!validTypes.includes(assessmentType)) {
      return res.status(400).json({ message: `assessmentType は ${validTypes.join("/")} のいずれかを指定してください` });
    }

    if (closingDay != null) {
      const cd = Number(closingDay);
      if (!Number.isInteger(cd) || cd < 1 || (cd > 31 && cd !== 99)) {
        return res.status(400).json({ message: "closingDay は 1〜31 または 99（月末）を指定してください" });
      }
    }

    let effectiveStart = startDate;
    let effectiveEnd = endDate;

    if (closingDay != null) {
      const cd = Number(closingDay);
      const result = applyClosingDay(startDate, endDate, cd);
      effectiveStart = result.effectiveStart;
      effectiveEnd = result.effectiveEnd;
    }

    // 仕入先グループフィルタ用 vendorId セット
    let groupVendorIds: Set<number> | null = null;
    if (groupId) {
      const vendorsInGroup = await db
        .select({ id: vendorsTable.id })
        .from(vendorsTable)
        .where(eq(vendorsTable.groupId, Number(groupId)));
      groupVendorIds = new Set(vendorsInGroup.map((v) => v.id));
    }

    let items: AssessmentResultItem[];

    if (assessmentType === "vendor_project_worktype") {
      /**
       * 工種別モード: purchase_invoice_items 単位で集計
       * （カテゴリは明細行レベルの概念）
       */
      let rawRows = await db
        .select({
          invoiceItemId: purchaseInvoiceItemsTable.id,
          projectId: purchaseInvoicesTable.projectId,
          vendorId: purchaseInvoicesTable.vendorId,
          vendorName: vendorsTable.name,
          projectCode: projectsTable.projectCode,
          projectName: projectsTable.name,
          amount: purchaseInvoiceItemsTable.amount,
          category: purchaseInvoiceItemsTable.category,
        })
        .from(purchaseInvoiceItemsTable)
        .innerJoin(
          purchaseInvoicesTable,
          eq(purchaseInvoiceItemsTable.purchaseInvoiceId, purchaseInvoicesTable.id)
        )
        .innerJoin(vendorsTable, eq(purchaseInvoicesTable.vendorId, vendorsTable.id))
        .innerJoin(projectsTable, eq(purchaseInvoicesTable.projectId, projectsTable.id))
        .where(
          and(
            gte(purchaseInvoicesTable.purchaseDate, effectiveStart),
            lte(purchaseInvoicesTable.purchaseDate, effectiveEnd),
            eq(purchaseInvoicesTable.isProvisional, false),
            ne(purchaseInvoicesTable.status, "cancelled"),
            // 査定済みは除外（二重査定防止）。includeAssessed=true のときだけ含める
            ...(includeAssessed ? [] : [isNull(purchaseInvoicesTable.assessedAt)])
          )
        );

      if (groupVendorIds !== null) {
        rawRows = groupVendorIds.size > 0
          ? rawRows.filter((r) => groupVendorIds!.has(r.vendorId))
          : [];
      }

      const map = new Map<string, AssessmentResultItem>();
      for (const row of rawRows) {
        const vendorName = row.vendorName ?? "（仕入先未登録）";
        const key = `${vendorName}__${row.projectId}__${row.category}`;
        if (!map.has(key)) {
          map.set(key, {
            vendor: vendorName,
            projectId: row.projectId,
            projectCode: row.projectCode,
            projectName: row.projectName,
            workType: row.category ?? undefined,
            totalAmount: 0,
            holdAmount: 0,
            payAmount: 0,
            costItemIds: [],
          });
        }
        const entry = map.get(key)!;
        entry.totalAmount += parseNum(row.amount);
        entry.costItemIds.push(row.invoiceItemId);
      }

      items = Array.from(map.values()).map((item) => ({
        ...item,
        totalAmount: Math.round(item.totalAmount),
        payAmount: Math.round(item.totalAmount),
      }));
    } else {
      /**
       * vendor / vendor_project モード:
       * purchase_invoices の totalAmount 単位で集計（確定・本伝票のみ）
       */
      let rawInvoices = await db
        .select({
          invoiceId: purchaseInvoicesTable.id,
          projectId: purchaseInvoicesTable.projectId,
          vendorId: purchaseInvoicesTable.vendorId,
          totalAmount: purchaseInvoicesTable.totalAmount,
          vendorName: vendorsTable.name,
          projectCode: projectsTable.projectCode,
          projectName: projectsTable.name,
        })
        .from(purchaseInvoicesTable)
        .innerJoin(vendorsTable, eq(purchaseInvoicesTable.vendorId, vendorsTable.id))
        .innerJoin(projectsTable, eq(purchaseInvoicesTable.projectId, projectsTable.id))
        .where(
          and(
            gte(purchaseInvoicesTable.purchaseDate, effectiveStart),
            lte(purchaseInvoicesTable.purchaseDate, effectiveEnd),
            eq(purchaseInvoicesTable.isProvisional, false),
            ne(purchaseInvoicesTable.status, "cancelled"),
            // 査定済みは除外（二重査定防止）。includeAssessed=true のときだけ含める
            ...(includeAssessed ? [] : [isNull(purchaseInvoicesTable.assessedAt)])
          )
        );

      if (groupVendorIds !== null) {
        rawInvoices = groupVendorIds.size > 0
          ? rawInvoices.filter((r) => groupVendorIds!.has(r.vendorId))
          : [];
      }

      if (assessmentType === "vendor") {
        /**
         * Vendor-only: one row per vendor, per-project breakdown for confirm step
         */
        const vendorMap = new Map<
          string,
          {
            vendor: string;
            totalAmount: number;
            costItemIds: number[];
            projectMap: Map<number, { projectId: number; projectCode: string; projectName: string; amount: number; costItemIds: number[] }>;
          }
        >();

        for (const inv of rawInvoices) {
          const vendorName = inv.vendorName ?? "（仕入先未登録）";
          if (!vendorMap.has(vendorName)) {
            vendorMap.set(vendorName, { vendor: vendorName, totalAmount: 0, costItemIds: [], projectMap: new Map() });
          }
          const entry = vendorMap.get(vendorName)!;
          const amt = parseNum(inv.totalAmount);
          entry.totalAmount += amt;
          entry.costItemIds.push(inv.invoiceId);

          if (!entry.projectMap.has(inv.projectId)) {
            entry.projectMap.set(inv.projectId, { projectId: inv.projectId, projectCode: inv.projectCode, projectName: inv.projectName, amount: 0, costItemIds: [] });
          }
          const proj = entry.projectMap.get(inv.projectId)!;
          proj.amount += amt;
          proj.costItemIds.push(inv.invoiceId);
        }

        items = Array.from(vendorMap.values()).map((entry) => {
          const projectBreakdowns = Array.from(entry.projectMap.values()).map((p) => ({ ...p, amount: Math.round(p.amount) }));
          const firstProject = projectBreakdowns[0] ?? { projectId: 0, projectCode: "", projectName: "", amount: 0, costItemIds: [] };
          return {
            vendor: entry.vendor,
            projectId: firstProject.projectId,
            projectCode: firstProject.projectCode,
            projectName: firstProject.projectName,
            totalAmount: Math.round(entry.totalAmount),
            holdAmount: 0,
            payAmount: Math.round(entry.totalAmount),
            costItemIds: entry.costItemIds,
            projectBreakdowns,
          };
        });
      } else {
        /**
         * vendor_project: one row per vendor+project
         */
        const map = new Map<string, AssessmentResultItem>();
        for (const inv of rawInvoices) {
          const vendorName = inv.vendorName ?? "（仕入先未登録）";
          const key = `${vendorName}__${inv.projectId}`;
          if (!map.has(key)) {
            map.set(key, { vendor: vendorName, projectId: inv.projectId, projectCode: inv.projectCode, projectName: inv.projectName, totalAmount: 0, holdAmount: 0, payAmount: 0, costItemIds: [] });
          }
          const entry = map.get(key)!;
          entry.totalAmount += parseNum(inv.totalAmount);
          entry.costItemIds.push(inv.invoiceId);
        }
        items = Array.from(map.values()).map((item) => ({ ...item, totalAmount: Math.round(item.totalAmount), payAmount: Math.round(item.totalAmount) }));
      }
    }

    items.sort((a, b) => {
      const vendorCmp = a.vendor.localeCompare(b.vendor, "ja");
      if (vendorCmp !== 0) return vendorCmp;
      const projectCmp = (a.projectCode ?? "").localeCompare(
        b.projectCode ?? ""
      );
      if (projectCmp !== 0) return projectCmp;
      return (a.workType ?? "").localeCompare(b.workType ?? "");
    });

    return res.json({ items, total: items.length, effectiveStart, effectiveEnd });
  } catch (err) {
    req.log.error({ err }, "Failed to calculate payment assessment");
    return res.status(500).json({ message: "Internal server error" });
  }
});

interface PaymentRow {
  id: number;
  projectId: number;
  vendor: string;
  description: string;
  amount: string;
  paidAmount: string | null;
  dueDate: string | null;
  paidDate: string | null;
  status: string;
  source: string;
  invoiceNumber: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * POST /api/payment-assessments/confirm
 * For vendor-only mode rows that carry projectBreakdowns, creates one payment
 * per project (proportional share of hold amount).
 * For vendor_project / vendor_project_worktype rows, creates one payment per row.
 */
router.post("/confirm", async (req, res) => {
  try {
    const { dueDate, assessmentKey, items, assessmentType = "vendor" } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items は必須です" });
    }

    const workTypeLabel: Record<string, string> = {
      material: "材料費",
      labor: "労務費",
      subcontract: "外注費",
      expense: "経費",
    };

    const createdRows: PaymentRow[] = [];
    const updatedRows: PaymentRow[] = [];

    for (const item of items as AssessmentResultItem[]) {
      const { vendor, workType, holdAmount = 0, projectBreakdowns } = item;
      const totalAmount = item.totalAmount;
      const payAmount = item.payAmount ?? totalAmount;
      if (!vendor || payAmount <= 0) continue;

      const descParts = ["支払査定"];
      if (workType) descParts.push(`[${workTypeLabel[workType] ?? workType}]`);
      const description = descParts.join(" ");

      /**
       * Vendor-only mode: split payment into one record per project,
       * proportional to each project's share of the total.
       * Hold amount is also split proportionally.
       */
      if (projectBreakdowns && projectBreakdowns.length > 0) {
        for (const proj of projectBreakdowns as ProjectBreakdown[]) {
          const ratio = totalAmount > 0 ? proj.amount / totalAmount : 1 / projectBreakdowns.length;
          const projPay = Math.round(proj.amount - holdAmount * ratio);
          if (projPay <= 0) continue;

          const notesVal =
            holdAmount > 0
              ? `保留金按分: ${Math.round(holdAmount * ratio).toLocaleString()}円`
              : null;
          const invoiceVal = assessmentKey
            ? `key:${assessmentKey}:${proj.projectId}`
            : null;

          if (assessmentKey) {
            const existing = await db
              .select()
              .from(paymentsTable)
              .where(
                and(
                  eq(paymentsTable.source, "assessment"),
                  eq(paymentsTable.vendor, vendor),
                  eq(paymentsTable.projectId, proj.projectId),
                  eq(paymentsTable.description, description),
                  eq(paymentsTable.invoiceNumber, `key:${assessmentKey}:${proj.projectId}`)
                )
              )
              .limit(1);

            if (existing[0]) {
              const [upd] = await db
                .update(paymentsTable)
                .set({
                  amount: String(projPay),
                  dueDate: dueDate ?? null,
                  notes: notesVal,
                  updatedAt: new Date(),
                })
                .where(eq(paymentsTable.id, existing[0].id))
                .returning();
              if (upd) updatedRows.push(upd as PaymentRow);
              continue;
            }
          }

          const [payment] = await db
            .insert(paymentsTable)
            .values({
              projectId: proj.projectId,
              vendor,
              description,
              amount: String(projPay),
              dueDate: dueDate ?? null,
              status: "pending",
              source: "assessment",
              invoiceNumber: invoiceVal,
              notes: notesVal,
            })
            .returning();
          if (payment) createdRows.push(payment as PaymentRow);
        }
      } else {
        /**
         * vendor_project / vendor_project_worktype mode:
         * one payment per row, projectId from row.
         */
        const { projectId } = item;
        if (!projectId) continue;

        const notesVal =
          holdAmount > 0
            ? `保留金: ${Number(holdAmount).toLocaleString()}円`
            : null;
        const invoiceVal = assessmentKey
          ? `key:${assessmentKey}:${projectId}:${workType ?? ""}`
          : null;

        if (assessmentKey) {
          const existing = await db
            .select()
            .from(paymentsTable)
            .where(
              and(
                eq(paymentsTable.source, "assessment"),
                eq(paymentsTable.vendor, vendor),
                eq(paymentsTable.projectId, Number(projectId)),
                eq(paymentsTable.description, description),
                eq(paymentsTable.invoiceNumber, `key:${assessmentKey}:${projectId}:${workType ?? ""}`)
              )
            )
            .limit(1);

          if (existing[0]) {
            const [upd] = await db
              .update(paymentsTable)
              .set({
                amount: String(payAmount),
                dueDate: dueDate ?? null,
                notes: notesVal,
                updatedAt: new Date(),
              })
              .where(eq(paymentsTable.id, existing[0].id))
              .returning();
            if (upd) updatedRows.push(upd as PaymentRow);
            continue;
          }
        }

        const [payment] = await db
          .insert(paymentsTable)
          .values({
            projectId: Number(projectId),
            vendor,
            description,
            amount: String(payAmount),
            dueDate: dueDate ?? null,
            status: "pending",
            source: "assessment",
            invoiceNumber: invoiceVal,
            notes: notesVal,
          })
          .returning();
        if (payment) createdRows.push(payment as PaymentRow);
      }
    }

    // 査定確定した仕入伝票に「査定済み」の印をつける（次回集計から除外＝二重査定防止）
    const rawIds = (items as AssessmentResultItem[])
      .flatMap((it) => it.costItemIds ?? [])
      .filter((n): n is number => typeof n === "number");
    const uniqueIds = Array.from(new Set(rawIds));
    if (uniqueIds.length > 0) {
      let invoiceIds: number[];
      if (assessmentType === "vendor_project_worktype") {
        // 工種別モードの costItemIds は明細行ID → 仕入伝票IDへ解決
        const rows = await db
          .select({ invoiceId: purchaseInvoiceItemsTable.purchaseInvoiceId })
          .from(purchaseInvoiceItemsTable)
          .where(inArray(purchaseInvoiceItemsTable.id, uniqueIds));
        invoiceIds = Array.from(new Set(rows.map((r) => r.invoiceId)));
      } else {
        invoiceIds = uniqueIds;
      }
      if (invoiceIds.length > 0) {
        await db
          .update(purchaseInvoicesTable)
          .set({ assessedAt: new Date(), updatedAt: new Date() })
          .where(inArray(purchaseInvoicesTable.id, invoiceIds));
      }
    }

    return res.status(201).json({
      created: createdRows.length,
      updated: updatedRows.length,
      items: [...createdRows, ...updatedRows],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to confirm payment assessment");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
