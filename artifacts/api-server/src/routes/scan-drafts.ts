import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, scanDraftsTable } from "@workspace/db";
import { uploadInvoiceFile, readStoredFile, deleteInvoiceFile, newStorageKey } from "../lib/invoice-storage";

const router: IRouter = Router();

// ─── スキャンの下書き（①②③）──────────────────────────────────────────────────
//
// スキャンする画面でまとめて取り込んだ書類を、確認前の下書きとして置いておく。
// AIの読み取りは画面側で ai-extract を呼んで済ませ、その返り値と原本をここに保存する。
// 確認画面（/scan/prime-order 等）は ?draft=ID で開き、ここから読み取り結果と原本を取り直す。

const KINDS = ["prime-order", "client-estimate", "subcontract-estimate"] as const;
type Kind = (typeof KINDS)[number];

type Extract = { draft?: Record<string, unknown> } | null;

// 一覧に出す見出しと金額。読み取り結果から拾う（読めなかった下書きは空）
function summarize(kind: string, extract: Extract): { title: string; amount: number | null } {
  const d = extract?.draft ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  if (kind === "subcontract-estimate") {
    const title = [str(d["vendorName"]), str(d["projectName"])].filter(Boolean).join("／");
    return { title, amount: num(d["decidedAmount"]) ?? num(d["subtotal"]) };
  }
  return { title: str(d["projectName"]), amount: num(d["taxIncludedAmount"]) };
}

// GET /api/scan-drafts — 確認待ちの下書き（取り込んだ順。上から順に確かめてもらう）
router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(scanDraftsTable)
      .where(eq(scanDraftsTable.status, "draft"))
      .orderBy(asc(scanDraftsTable.id));
    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        fileName: r.fileName,
        error: r.error,
        createdAt: r.createdAt,
        ...summarize(r.kind, r.extract as Extract),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list scan drafts");
    return res.status(500).json({ message: "下書きの取得に失敗しました。" });
  }
});

// POST /api/scan-drafts — 下書きを作る（原本と読み取り結果を保存）
router.post("/", async (req, res) => {
  try {
    const { kind, fileName, fileBase64, mediaType, extract, error } = req.body ?? {};
    if (!KINDS.includes(kind as Kind)) return res.status(400).json({ message: "書類の種類が正しくありません" });
    if (typeof fileBase64 !== "string" || !fileBase64) return res.status(400).json({ message: "ファイルがありません" });
    const media = typeof mediaType === "string" && mediaType ? mediaType : "application/pdf";
    const filePath = newStorageKey(media, "scan-drafts/");
    await uploadInvoiceFile(filePath, fileBase64, media);
    const [row] = await db
      .insert(scanDraftsTable)
      .values({
        kind,
        fileName: typeof fileName === "string" ? fileName : "",
        filePath,
        mediaType: media,
        extract: extract ?? null,
        error: typeof error === "string" && error ? error : null,
      })
      .returning({ id: scanDraftsTable.id });
    return res.status(201).json({ id: row.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create scan draft");
    return res.status(500).json({ message: "下書きの保存に失敗しました。" });
  }
});

// GET /api/scan-drafts/:id — 確認画面を開き直すための中身（読み取り結果＋原本のbase64）
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [r] = await db.select().from(scanDraftsTable).where(eq(scanDraftsTable.id, id));
    if (!r) return res.status(404).json({ message: "下書きが見つかりません" });
    const buf = r.filePath ? await readStoredFile(r.filePath) : null;
    return res.json({
      id: r.id,
      kind: r.kind,
      status: r.status,
      fileName: r.fileName,
      mediaType: r.mediaType,
      fileBase64: buf ? buf.toString("base64") : null,
      extract: r.extract,
      error: r.error,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get scan draft");
    return res.status(500).json({ message: "下書きの取得に失敗しました。" });
  }
});

// POST /api/scan-drafts/:id/done — 登録が済んだ（一覧から外す）
router.post("/:id/done", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const projectId = Number(req.body?.projectId);
    await db
      .update(scanDraftsTable)
      .set({ status: "done", doneAt: new Date(), projectId: Number.isFinite(projectId) && projectId > 0 ? projectId : null })
      .where(eq(scanDraftsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to finish scan draft");
    return res.status(500).json({ message: "下書きの更新に失敗しました。" });
  }
});

// DELETE /api/scan-drafts/:id — 要らない下書きを消す（登録済みは消さない）
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [r] = await db.select().from(scanDraftsTable).where(eq(scanDraftsTable.id, id));
    if (!r) return res.status(404).json({ message: "見つかりません" });
    if (r.status !== "draft") return res.status(409).json({ message: "登録済みの書類は消せません。" });
    if (r.filePath) await deleteInvoiceFile(r.filePath);
    await db.delete(scanDraftsTable).where(eq(scanDraftsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete scan draft");
    return res.status(500).json({ message: "削除に失敗しました。" });
  }
});

export default router;
