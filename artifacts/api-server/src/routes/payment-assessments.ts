import { Router, type IRouter } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, costItemsTable, paymentsTable, projectsTable, vendorsTable } from "@workspace/db";

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

    let rawItems = await db
      .select({
        id: costItemsTable.id,
        projectId: costItemsTable.projectId,
        vendor: costItemsTable.vendor,
        category: costItemsTable.category,
        amount: costItemsTable.amount,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
      })
      .from(costItemsTable)
      .innerJoin(
        projectsTable,
        eq(costItemsTable.projectId, projectsTable.id)
      )
      .where(
        and(
          gte(costItemsTable.incurredDate, effectiveStart),
          lte(costItemsTable.incurredDate, effectiveEnd)
        )
      );

    if (groupId) {
      const vendorsInGroup = await db
        .select({ name: vendorsTable.name })
        .from(vendorsTable)
        .where(eq(vendorsTable.groupId, Number(groupId)));
      const groupVendorNames = new Set(vendorsInGroup.map((v) => v.name));
      if (groupVendorNames.size > 0) {
        rawItems = rawItems.filter(
          (item) => item.vendor && groupVendorNames.has(item.vendor)
        );
      } else {
        rawItems = [];
      }
    }

    let items: AssessmentResultItem[];

    if (assessmentType === "vendor") {
      /**
       * Vendor-only mode:
       * - Display one aggregated row per vendor
       * - Track per-project breakdown so confirm can create per-project payments
       */
      const vendorMap = new Map<
        string,
        {
          vendor: string;
          totalAmount: number;
          costItemIds: number[];
          projectMap: Map<
            number,
            {
              projectId: number;
              projectCode: string;
              projectName: string;
              amount: number;
              costItemIds: number[];
            }
          >;
        }
      >();

      for (const item of rawItems) {
        const vendorName = item.vendor ?? "（仕入先未登録）";
        if (!vendorMap.has(vendorName)) {
          vendorMap.set(vendorName, {
            vendor: vendorName,
            totalAmount: 0,
            costItemIds: [],
            projectMap: new Map(),
          });
        }
        const entry = vendorMap.get(vendorName)!;
        const amt = parseNum(item.amount);
        entry.totalAmount += amt;
        entry.costItemIds.push(item.id);

        if (!entry.projectMap.has(item.projectId)) {
          entry.projectMap.set(item.projectId, {
            projectId: item.projectId,
            projectCode: item.projectCode,
            projectName: item.projectName,
            amount: 0,
            costItemIds: [],
          });
        }
        const proj = entry.projectMap.get(item.projectId)!;
        proj.amount += amt;
        proj.costItemIds.push(item.id);
      }

      items = Array.from(vendorMap.values()).map((entry) => {
        const projectBreakdowns = Array.from(entry.projectMap.values()).map(
          (p) => ({
            ...p,
            amount: Math.round(p.amount),
          })
        );
        // Use first project as representative for display only
        const firstProject = projectBreakdowns[0] ?? {
          projectId: 0,
          projectCode: "",
          projectName: "",
          amount: 0,
          costItemIds: [],
        };
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
       * vendor_project and vendor_project_worktype modes:
       * - Generate one row per vendor+project (or vendor+project+worktype)
       */
      const map = new Map<string, AssessmentResultItem>();

      for (const item of rawItems) {
        const vendorName = item.vendor ?? "（仕入先未登録）";
        const key =
          assessmentType === "vendor_project_worktype"
            ? `${vendorName}__${item.projectId}__${item.category}`
            : `${vendorName}__${item.projectId}`;

        if (!map.has(key)) {
          map.set(key, {
            vendor: vendorName,
            projectId: item.projectId,
            projectCode: item.projectCode,
            projectName: item.projectName,
            workType:
              assessmentType === "vendor_project_worktype"
                ? (item.category ?? undefined)
                : undefined,
            totalAmount: 0,
            holdAmount: 0,
            payAmount: 0,
            costItemIds: [],
          });
        }
        const entry = map.get(key)!;
        entry.totalAmount += parseNum(item.amount);
        entry.costItemIds.push(item.id);
      }

      items = Array.from(map.values()).map((item) => ({
        ...item,
        totalAmount: Math.round(item.totalAmount),
        payAmount: Math.round(item.totalAmount),
      }));
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

    res.json({ items, total: items.length, effectiveStart, effectiveEnd });
  } catch (err) {
    req.log.error({ err }, "Failed to calculate payment assessment");
    res.status(500).json({ message: "Internal server error" });
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
    const { dueDate, assessmentKey, items } = req.body;

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

    res.status(201).json({
      created: createdRows.length,
      updated: updatedRows.length,
      items: [...createdRows, ...updatedRows],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to confirm payment assessment");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
