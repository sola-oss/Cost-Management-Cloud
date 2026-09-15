// 書類1枚をAIで読み取って「受領書類」を作るところ。
// 仕入の振り分けの一覧と、スキャンする画面の両方から呼ぶので、ここに切り出してある。

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** AIそのものが使えない（キー未設定・無効・AI側の不調）。束で読むとき、残りを投げても無駄なので止める合図。 */
export class AiUnavailableError extends Error {}

/** 原価計上の段階。納品書は仮原価、請求書は確定原価。 */
export type ImportStage = "provisional" | "confirmed";

export type ImportResult = {
  id: number;
  lines: number;
  amountMismatch: boolean;
  amountDiff: number;
};

/**
 * 1件ぶんの読み取り。失敗は投げっぱなしにして、呼び出し側が「その1件だけ飛ばす」判断をする。
 */
export async function readOneFile(file: File, stage: ImportStage = "confirmed"): Promise<ImportResult> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

  const ex = await fetch(`${BASE}/api/ai-extract/purchase-invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64: base64, mediaType: file.type || "application/pdf" }),
  });
  if (!ex.ok) {
    const e = await ex.json().catch(() => ({}));
    // AIが使えないときは、サーバが理由を日本語で返す。それをそのまま見せて手入力へ案内する。
    if (ex.status === 503) {
      const why = (e as { message?: string }).message ?? "AI読み取りは今は使えません。";
      throw new AiUnavailableError(`${why}「AIを使わず手で入力する」からお願いします。`);
    }
    throw new Error((e as { message?: string }).message ?? "AI読み取りに失敗しました");
  }
  const { draft, vendorMatches, amountMismatch, amountDiff } = await ex.json();

  // 仕入先マスタの候補（完全一致 or 最有力）を初期値にする
  const vendorId: number | null = vendorMatches?.[0]?.id ?? null;

  const create = await fetch(`${BASE}/api/received-invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vendorId,
      vendorName: draft.vendorName ?? "",
      invoiceDate: draft.invoiceDate || null,
      paymentDueDate: draft.paymentDueDate || null,
      subtotal: draft.subtotal ?? 0,
      taxAmount: draft.taxAmount ?? 0,
      totalAmount: draft.totalAmount ?? 0,
      aiExtracted: true,
      amountMismatch: !!amountMismatch,
      stage,
      items: draft.items ?? [],
      fileBase64: base64,
      mediaType: file.type || "application/pdf",
    }),
  });
  if (!create.ok) throw new Error("受領書類の作成に失敗しました");
  const { id } = await create.json();

  return {
    id,
    lines: (draft.items ?? []).length,
    amountMismatch: !!amountMismatch,
    amountDiff: Math.abs(amountDiff ?? 0),
  };
}
