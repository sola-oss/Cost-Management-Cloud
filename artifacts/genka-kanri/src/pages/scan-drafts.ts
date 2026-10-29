// ①②③の下書き（スキャンする画面でまとめて取り込み、あとで1件ずつ確かめる）。
// 取り込み時にAIで読み取っておき、確認画面は ?draft=ID で開いてその結果を使う。
import { AiUnavailableError } from "./received-invoices/import";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type ScanDraftKind = "prime-order" | "client-estimate" | "subcontract-estimate";

const EXTRACT_PATH: Record<ScanDraftKind, string> = {
  "prime-order": "/api/ai-extract/prime-order",
  "client-estimate": "/api/ai-extract/client-estimate",
  "subcontract-estimate": "/api/ai-extract/subcontract-estimate",
};

export const SCAN_DRAFT_PAGE: Record<ScanDraftKind, string> = {
  "prime-order": "/scan/prime-order",
  "client-estimate": "/scan/client-estimate",
  "subcontract-estimate": "/scan/subcontract-estimate",
};

export const SCAN_DRAFTS_QUERY_KEY = ["/api/scan-drafts"];

export type ScanDraftRow = {
  id: number;
  kind: ScanDraftKind;
  fileName: string;
  error: string | null;
  createdAt: string;
  title: string;
  amount: number | null;
};

export function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/**
 * 1件読み取って下書きにする。読めなかったときも原本だけは下書きに残し、確認画面で手入力してもらう。
 * skipAi のときは読み取らずに残す（AIそのものが使えないと分かった後の残り）。
 * AIが使えないと分かったら AiUnavailableError を投げる（下書きは作ったあと）。
 */
export async function createScanDraft(
  file: File,
  kind: ScanDraftKind,
  skipAi = false,
): Promise<{ id: number; error: string | null }> {
  const base64 = await fileToBase64(file);
  const mediaType = file.type || "application/pdf";
  let extract: unknown = null;
  let error: string | null = skipAi ? "AI読み取りが使えなかったので読み取っていません。" : null;
  let aiDown: string | null = null;
  if (!skipAi) {
    const r = await fetch(`${BASE}${EXTRACT_PATH[kind]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileBase64: base64, mediaType }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok) {
      extract = body;
    } else {
      error = (body as { message?: string }).message ?? "読み取りに失敗しました";
      if (r.status === 503) aiDown = error;
    }
  }
  const c = await fetch(`${BASE}/api/scan-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, fileName: file.name, fileBase64: base64, mediaType, extract, error }),
  });
  if (!c.ok) throw new Error("下書きの保存に失敗しました");
  const { id } = await c.json();
  if (aiDown) throw new AiUnavailableError(aiDown);
  return { id, error };
}

export type LoadedScanDraft = {
  file: { base64: string; mediaType: string; url: string; name: string } | null;
  extract: unknown;
  error: string | null;
};

/** 確認画面で下書きを開き直す。原本はプレビュー用のURLにして返す。 */
export async function loadScanDraft(id: number): Promise<LoadedScanDraft> {
  const r = await fetch(`${BASE}/api/scan-drafts/${id}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.message ?? "下書きを開けませんでした");
  if (body.status !== "draft") throw new Error("この書類はもう登録済みです");
  let file: LoadedScanDraft["file"] = null;
  if (body.fileBase64) {
    const mediaType = body.mediaType || "application/pdf";
    const bin = atob(body.fileBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
    file = { base64: body.fileBase64, mediaType, url, name: body.fileName ?? "" };
  }
  return { file, extract: body.extract, error: body.error ?? null };
}

/** 登録が済んだ下書きを一覧から外す。失敗しても登録自体は済んでいるので投げない。 */
export async function finishScanDraft(id: number, projectId: number | null): Promise<void> {
  await fetch(`${BASE}/api/scan-drafts/${id}/done`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  }).catch(() => {});
}

/** 確認待ちで残っている下書きの件数。登録のあと、一覧に戻るか登録先を見せるかを決めるのに使う。 */
export async function remainingScanDrafts(): Promise<number> {
  const r = await fetch(`${BASE}/api/scan-drafts`).catch(() => null);
  if (!r?.ok) return 0;
  const body = await r.json().catch(() => ({}));
  return (body.items ?? []).length;
}

/** 確認画面のURLに付いている下書きのID（無ければ null）。 */
export function draftIdFromUrl(): number | null {
  const v = new URLSearchParams(window.location.search).get("draft");
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
