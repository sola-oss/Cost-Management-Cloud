import { eq, inArray } from "drizzle-orm";
import { db, purchaseInvoicesTable, purchaseInvoiceItemsTable, costItemsTable } from "@workspace/db";
import type { Tx } from "./unique-number";

// ─── 仕入伝票の生成ヘルパー ─────────────────────────────────────────────────
//
// routes/purchase-invoices.ts が持つ採番・原価明細同期と同じ処理を、
// 受領請求書（仮デジタル請求書）の確定からも使えるように切り出したもの。
// 採番は「DBの既存 voucherNumber を見て最大+1」なので、両方から呼んでも
// 番号の一意性は withUniqueNumberTransaction のリトライで担保される。

/** ST-YYYYMMDD-NNNN 形式の伝票番号を採番する（当日分の最大連番+1）。 */
export async function generateVoucherNumber(): Promise<string> {
  const today = new Date();
  const ymd =
    String(today.getFullYear()) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `ST-${ymd}-`;
  const all = await db.select({ n: purchaseInvoicesTable.voucherNumber }).from(purchaseInvoicesTable);
  const todayNums = all
    .map((r) => r.n)
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const next = todayNums.length > 0 ? Math.max(...todayNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

/** 仕入伝票の各明細行に対応する cost_items を作成し costItemId を更新する。 */
export async function syncCostItemsAfterInvoice(
  tx: Tx,
  projectId: number,
  purchaseDate: string,
  voucherNumber: string,
  isProvisional: boolean,
  vendorName: string,
  vendorId: number,
  insertedItems: typeof purchaseInvoiceItemsTable.$inferSelect[],
) {
  for (const item of insertedItems) {
    const [ci] = await tx
      .insert(costItemsTable)
      .values({
        projectId,
        category: item.category as "material" | "labor" | "subcontract" | "expense",
        description: item.description,
        vendor: vendorName,
        vendorId,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        unitPrice: item.unitPrice ?? null,
        amount: item.amount,
        incurredDate: purchaseDate,
        invoiceNumber: voucherNumber,
        notes: isProvisional ? "仮伝票" : null,
        sourceType: "purchase_invoice",
        sourceId: item.id,
        workTypeId: item.workTypeId ?? null,
      })
      .returning();

    await tx
      .update(purchaseInvoiceItemsTable)
      .set({ costItemId: ci.id })
      .where(eq(purchaseInvoiceItemsTable.id, item.id));
  }
}

/** 明細から税抜・消費税・税込を計算する（行ごとに税率を適用し切り捨て）。 */
export function calcTotals(items: Array<{ amount: number; taxRate: number }>) {
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxAmount = items.reduce((s, i) => s + Math.floor((i.amount * i.taxRate) / 100), 0);
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

/**
 * 仕入伝票に紐づく cost_items を全削除する。
 * 伝票を消すとき（仕入入力の削除・受領請求書の確定取り消し）に使う。
 * これを忘れると原価だけが残る。
 */
export async function deleteCostItemsByInvoiceId(tx: Tx, invoiceId: number) {
  const items = await tx
    .select({ costItemId: purchaseInvoiceItemsTable.costItemId })
    .from(purchaseInvoiceItemsTable)
    .where(eq(purchaseInvoiceItemsTable.purchaseInvoiceId, invoiceId));

  const costItemIds = items
    .map((i) => i.costItemId)
    .filter((id): id is number => id != null);

  if (costItemIds.length > 0) {
    await tx.delete(costItemsTable).where(inArray(costItemsTable.id, costItemIds));
  }
}
