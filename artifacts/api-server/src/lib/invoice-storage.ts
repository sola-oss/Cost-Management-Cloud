import { promises as fs } from "node:fs";
import path from "node:path";

// ─── 受領請求書の原本ファイル保存 ────────────────────────────────────────────
//
// 本番: Supabase Storage（非公開バケット received-invoices）。署名付きURLで見せる。
// ローカル検証: SUPABASE_URL/KEY が無ければローカルフォルダに保存（cmc_verify 用）。
//
// フロントは Supabase を一切触らない。アップロードは base64 でAPIに渡し、
// 閲覧は GET /api/received-invoices/:id/file 経由（本番は署名URLへリダイレクト、
// ローカルはファイルをそのまま配信）。

const SUPABASE_URL = process.env["SUPABASE_URL"];
const SUPABASE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const BUCKET = process.env["INVOICE_BUCKET"] ?? "received-invoices";
const LOCAL_DIR = process.env["LOCAL_STORAGE_DIR"] ?? "/tmp/cmc-local-storage";

export const storageMode: "supabase" | "local" =
  SUPABASE_URL && SUPABASE_KEY ? "supabase" : "local";

function localPath(key: string): string {
  // key に .. などが混じっても LOCAL_DIR の外に出さない
  const safe = path.normalize(key).replace(/^(\.\.[/\\])+/, "");
  return path.join(LOCAL_DIR, safe);
}

/** 原本ファイルを保存する。key は received-invoices 内の相対パス（例 "2026/07/uuid.pdf"）。 */
export async function uploadInvoiceFile(key: string, base64: string, mediaType: string): Promise<void> {
  const buf = Buffer.from(base64, "base64");
  if (storageMode === "supabase") {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": mediaType,
        "x-upsert": "true",
      },
      body: buf,
    });
    if (!r.ok) {
      throw new Error(`Supabase Storage upload failed: ${r.status} ${await r.text()}`);
    }
    return;
  }
  const full = localPath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
}

/** 閲覧用の署名付きURL（本番のみ）。ローカルは null を返し、呼び出し側がファイル配信する。 */
export async function getSignedUrl(key: string, expiresIn = 3600): Promise<string | null> {
  if (storageMode !== "supabase") return null;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${encodeURI(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { signedURL?: string };
  return j.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
}

/** ローカルモードでファイル本体を読む（本番では署名URLへリダイレクトするので使わない）。 */
export async function readLocalFile(key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(localPath(key));
  } catch {
    return null;
  }
}

/** 原本ファイルを削除する（受領請求書の取消時など）。存在しなくてもエラーにしない。 */
export async function deleteInvoiceFile(key: string): Promise<void> {
  if (storageMode === "supabase") {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(key)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SUPABASE_KEY}` },
    }).catch(() => {});
    return;
  }
  await fs.rm(localPath(key), { force: true }).catch(() => {});
}
