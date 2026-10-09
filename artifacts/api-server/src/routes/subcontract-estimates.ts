import { Router, type IRouter } from "express";
import { eq, sql, desc, and, exists } from "drizzle-orm";
import { db, projectsTable, vendorsTable, budgetItemsTable, subcontractEstimatesTable } from "@workspace/db";
import { uploadInvoiceFile, getSignedUrl, readLocalFile, storageMode, newStorageKey } from "../lib/invoice-storage";

const router: IRouter = Router();

// ─── ③下請見積書 → 実行予算 ─────────────────────────────────────────────────
//
// スキャンした見積書を確かめて、実行予算（budget_items）に工種ごとの行として入れる。
// 見積書1枚ぶんの情報（仕入先・印字の合計・決定額・原本）は subcontract_estimates に残し、
// 実行予算の行から戻れるようにする（subcontract_estimate_id）。
// 決定額が印字の合計と違うときは、画面で工種ごとに割り振った額がそのまま届く（案A・アイさん判断 2026-10-09）。
// 工事は本登録・仮登録のどちらでもよい（③は工事が決まる前に届くことがあるため）。

function parseNumeric(val: unknown): number {
  const n = typeof val === "string" ? parseFloat(val) : Number(val);
  return Number.isFinite(n) ? n : 0;
}

type LineInput = { workTypeCode?: string; workTypeName?: string; amount?: number | string };

// 実行予算に行が1つでも残っている見積書だけを「入っている」とみなす。
// 行を「行削除」で全部消した見積書は、一覧にも二重取り込みの判定にも出さない（記録は残す）。
const hasBudgetRows = exists(
  db.select({ one: sql`1` }).from(budgetItemsTable)
    .where(eq(budgetItemsTable.subcontractEstimateId, subcontractEstimatesTable.id)),
);

// GET /api/subcontract-estimates?projectId= — 工事に取り込んだ見積書の一覧（実行予算の画面に出す）
router.get("/", async (req, res) => {
  try {
    const pid = Number(req.query["projectId"]);
    if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({ message: "projectId が必要です" });
    const rows = await db.select().from(subcontractEstimatesTable)
      .where(and(eq(subcontractEstimatesTable.projectId, pid), hasBudgetRows))
      .orderBy(desc(subcontractEstimatesTable.createdAt));
    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        estimateNumber: r.estimateNumber,
        estimateDate: r.estimateDate,
        printedTotal: parseNumeric(r.printedTotal),
        decidedTotal: parseNumeric(r.decidedTotal),
        hasFile: !!r.filePath,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list subcontract estimates");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/subcontract-estimates
router.post("/", async (req, res) => {
  try {
    const {
      projectId, vendorId, vendorName, estimateNumber, estimateDate,
      printedTotal, decidedTotal, lines, fileBase64, mediaType, allowDuplicate,
    } = req.body as {
      projectId?: number; vendorId?: number | null; vendorName?: string; estimateNumber?: string;
      estimateDate?: string; printedTotal?: number; decidedTotal?: number; lines?: LineInput[];
      fileBase64?: string; mediaType?: string; allowDuplicate?: boolean;
    };

    const pid = Number(projectId);
    if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({ message: "工事を選んでください" });
    const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, pid));
    if (!project) return res.status(400).json({ message: "工事を選んでください" });

    const rows = Array.isArray(lines) ? lines : [];
    if (rows.length === 0) return res.status(400).json({ message: "実行予算に入れる行がありません" });
    if (rows.some((l) => !String(l.workTypeCode ?? "").trim() || !String(l.workTypeName ?? "").trim())) {
      return res.status(400).json({ message: "すべての行で工種を選んでください" });
    }

    let vendor: { id: number; name: string; code: string | null } | undefined;
    if (vendorId != null) {
      if (!Number.isInteger(Number(vendorId))) return res.status(400).json({ message: "仕入先が見つかりません" });
      [vendor] = await db.select({ id: vendorsTable.id, name: vendorsTable.name, code: vendorsTable.code })
        .from(vendorsTable).where(eq(vendorsTable.id, Number(vendorId)));
      if (!vendor) return res.status(400).json({ message: "仕入先が見つかりません" });
    }
    const supplierName = vendor?.name ?? String(vendorName ?? "").trim();
    if (!supplierName) return res.status(400).json({ message: "仕入先を選んでください" });

    // 二重取り込みの検知：同じ工事に、同じ仕入先・同じ印字の合計の見積書がもう入っていたら止める。
    // 画面で「それでも入れる」を選んだときだけ通す（同じ額の見積書が別に来ることもあるため）
    if (!allowDuplicate && vendor) {
      const [dup] = await db.select({ id: subcontractEstimatesTable.id, createdAt: subcontractEstimatesTable.createdAt })
        .from(subcontractEstimatesTable)
        .where(and(
          eq(subcontractEstimatesTable.projectId, project.id),
          eq(subcontractEstimatesTable.vendorId, vendor.id),
          eq(subcontractEstimatesTable.printedTotal, String(parseNumeric(printedTotal))),
          hasBudgetRows,
        ));
      if (dup) {
        return res.status(409).json({ duplicate: true, message: "この見積書はもう実行予算に入っています" });
      }
    }

    // 原本を先に保存（DBに入れる前に。失敗したら中断）
    let filePath: string | null = null;
    const media = mediaType ?? "application/pdf";
    if (fileBase64) {
      filePath = newStorageKey(media, "subcontract-estimates/");
      await uploadInvoiceFile(filePath, fileBase64, media);
    }

    const result = await db.transaction(async (tx) => {
      const [estimate] = await tx.insert(subcontractEstimatesTable).values({
        projectId: project.id,
        vendorId: vendor?.id ?? null,
        vendorName: supplierName,
        estimateNumber: estimateNumber?.trim() || null,
        estimateDate: estimateDate || null,
        printedTotal: String(parseNumeric(printedTotal)),
        decidedTotal: String(parseNumeric(decidedTotal)),
        filePath,
        mediaType: filePath ? media : null,
      }).returning();

      // 既存の行の後ろに並べる
      const [maxRow] = await tx.select({ max: sql<number | null>`MAX(${budgetItemsTable.sortOrder})` })
        .from(budgetItemsTable).where(eq(budgetItemsTable.projectId, project.id));
      const start = (maxRow?.max ?? 0) + 1;

      const items = await tx.insert(budgetItemsTable).values(rows.map((l, i) => {
        const amount = String(parseNumeric(l.amount));
        return {
          projectId: project.id,
          workTypeCode: String(l.workTypeCode).trim(),
          workTypeName: String(l.workTypeName).trim(),
          supplierCode: vendor?.code ?? "",
          supplierName,
          vendorId: vendor?.id ?? null,
          // 見積書は最初の予算なので、当初予算と実行予算の両方に同じ額を入れる
          initialBudget: amount,
          revisedBudget: amount,
          sortOrder: start + i,
          subcontractEstimateId: estimate.id,
        };
      })).returning();
      return { estimate, count: items.length };
    });

    return res.status(201).json({ id: result.estimate.id, projectId: project.id, budgetItemCount: result.count });
  } catch (err) {
    req.log.error({ err }, "Failed to create subcontract estimate");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/subcontract-estimates/:id/file — 原本（本番=署名URLへリダイレクト / ローカル=そのまま配信）
router.get("/:id/file", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [e] = await db
      .select({ filePath: subcontractEstimatesTable.filePath, mediaType: subcontractEstimatesTable.mediaType })
      .from(subcontractEstimatesTable)
      .where(eq(subcontractEstimatesTable.id, id));
    if (!e?.filePath) return res.status(404).json({ message: "見積書の原本がありません" });
    if (storageMode === "supabase") {
      const url = await getSignedUrl(e.filePath);
      if (!url) return res.status(502).json({ message: "URLの発行に失敗しました" });
      return res.redirect(url);
    }
    const buf = await readLocalFile(e.filePath);
    if (!buf) return res.status(404).json({ message: "ファイルが見つかりません" });
    res.setHeader("Content-Type", e.mediaType ?? "application/octet-stream");
    return res.end(buf);
  } catch (err) {
    req.log.error({ err }, "Failed to serve subcontract estimate file");
    return res.status(500).json({ message: "ファイルの取得に失敗しました。" });
  }
});

export default router;
