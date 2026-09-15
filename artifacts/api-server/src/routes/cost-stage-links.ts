import { Router, type IRouter } from "express";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, purchaseInvoicesTable, vendorsTable, costItemsTable } from "@workspace/db";

// ─── 納品書（仮原価）と請求書（確定原価）の紐づけ ────────────────────────────
//
// おおつか様の依頼（2026-09-10）の 4-1 と、依頼事項の 7番。
// 納品書が先に届いて仮原価を入れたあと、同じ仕事の請求書が届く。紐づけないと
// 仮原価がいつまでも「請求書待ち」のまま残る。
//
// 金額はどちらも消さない（推移を残す）。工事の原価に入るのは確定原価だけなので、
// 紐づけても合計は動かない。金額が違うときは差額を出して知らせる。

const router: IRouter = Router();

const parseN = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0);

/**
 * GET /api/cost-stage-links?projectId=1
 *
 * その工事の「請求書待ちの納品書」と、紐づけ先の候補（同じ工事・同じ仕入先の請求書）を返す。
 * 候補は、まだどの納品書とも紐づいていないものだけ。
 */
router.get("/", async (req, res) => {
  try {
    const projectId = parseInt(String(req.query["projectId"] ?? ""));
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: "projectId は必須です" });
    }

    const rows = await db
      .select({ inv: purchaseInvoicesTable, vendorName: vendorsTable.name })
      .from(purchaseInvoicesTable)
      .leftJoin(vendorsTable, eq(purchaseInvoicesTable.vendorId, vendorsTable.id))
      .where(eq(purchaseInvoicesTable.projectId, projectId));

    const provisional = rows.filter((r) => r.inv.stage === "provisional");
    const confirmed = rows.filter((r) => r.inv.stage === "confirmed");
    // すでに他の納品書と紐づいている請求書は候補から外す（1対1にする）
    const takenIds = new Set(
      provisional.map((r) => r.inv.settledByInvoiceId).filter((v): v is number => v != null),
    );

    const items = provisional.map((r) => {
      const amount = parseN(r.inv.subtotal);
      const linked = r.inv.settledByInvoiceId
        ? confirmed.find((c) => c.inv.id === r.inv.settledByInvoiceId) ?? null
        : null;
      return {
        id: r.inv.id,
        voucherNumber: r.inv.voucherNumber,
        vendorName: r.vendorName ?? "",
        purchaseDate: r.inv.purchaseDate,
        totalAmount: amount,
        settledByInvoiceId: r.inv.settledByInvoiceId,
        settledBy: linked
          ? {
              id: linked.inv.id,
              voucherNumber: linked.inv.voucherNumber,
              purchaseDate: linked.inv.purchaseDate,
              totalAmount: parseN(linked.inv.subtotal),
              // 差額：請求書 − 納品書。プラスなら請求のほうが高い
              difference: parseN(linked.inv.subtotal) - amount,
            }
          : null,
        // 紐づけ先の候補。同じ仕入先を先に、次に同じ工事の他の請求書
        candidates: confirmed
          .filter((c) => !takenIds.has(c.inv.id) || c.inv.id === r.inv.settledByInvoiceId)
          .map((c) => ({
            id: c.inv.id,
            voucherNumber: c.inv.voucherNumber,
            vendorName: c.vendorName ?? "",
            purchaseDate: c.inv.purchaseDate,
            totalAmount: parseN(c.inv.subtotal),
            sameVendor: c.inv.vendorId === r.inv.vendorId,
            difference: parseN(c.inv.subtotal) - amount,
          }))
          .sort((a, b) => {
            if (a.sameVendor !== b.sameVendor) return a.sameVendor ? -1 : 1;
            // 金額が近い順（同じ仕事なら金額も近いはず）
            return Math.abs(a.difference) - Math.abs(b.difference);
          }),
      };
    });

    return res.json({ items });
  } catch (err) {
    req.log.error({ err }, "Failed to list cost stage links");
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * PATCH /api/cost-stage-links/:id   body: { settledByInvoiceId: number | null }
 *
 * :id は納品書（仮原価）の伝票。null を渡すと紐づけを外す。
 */
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params["id"]);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "不正なIDです" });
    const target = req.body?.settledByInvoiceId ?? null;

    const [provisional] = await db
      .select()
      .from(purchaseInvoicesTable)
      .where(eq(purchaseInvoicesTable.id, id));
    if (!provisional) return res.status(404).json({ message: "伝票が見つかりません" });
    if (provisional.stage !== "provisional") {
      return res.status(409).json({ message: "納品書（仮原価）の伝票だけ紐づけられます。" });
    }

    if (target != null) {
      const [confirmed] = await db
        .select()
        .from(purchaseInvoicesTable)
        .where(eq(purchaseInvoicesTable.id, Number(target)));
      if (!confirmed) return res.status(404).json({ message: "紐づけ先が見つかりません" });
      if (confirmed.stage !== "confirmed") {
        return res.status(409).json({ message: "紐づけ先は請求書（確定原価）の伝票にしてください。" });
      }
      if (confirmed.projectId !== provisional.projectId) {
        return res.status(409).json({ message: "同じ工事の伝票どうしでないと紐づけられません。" });
      }
      // 1つの請求書が複数の納品書に紐づくと、どれが精算済みか分からなくなる
      const already = await db
        .select({ id: purchaseInvoicesTable.id })
        .from(purchaseInvoicesTable)
        .where(and(
          eq(purchaseInvoicesTable.settledByInvoiceId, confirmed.id),
          ne(purchaseInvoicesTable.id, provisional.id),
        ));
      if (already.length > 0) {
        return res.status(409).json({ message: "その請求書は、ほかの納品書に紐づいています。" });
      }
    }

    await db
      .update(purchaseInvoicesTable)
      .set({ settledByInvoiceId: target == null ? null : Number(target), updatedAt: new Date() })
      .where(eq(purchaseInvoicesTable.id, id));

    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update cost stage link");
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * 工事ごとの「請求書待ちの仮原価」合計。
 * 請求書と紐づけ済みの納品書は、待ちから外す（もう請求書が来ているため）。
 * 原価は伝票番号（voucherNumber）を持っているので、それで絞る。
 */
export async function pendingProvisionalTotal(projectId: number): Promise<number> {
  const pending = await db
    .select({ voucherNumber: purchaseInvoicesTable.voucherNumber })
    .from(purchaseInvoicesTable)
    .where(and(
      eq(purchaseInvoicesTable.projectId, projectId),
      eq(purchaseInvoicesTable.stage, "provisional"),
      isNull(purchaseInvoicesTable.settledByInvoiceId),
    ));

  const items = await db
    .select({ amount: costItemsTable.amount, invoiceNumber: costItemsTable.invoiceNumber })
    .from(costItemsTable)
    .where(and(eq(costItemsTable.projectId, projectId), eq(costItemsTable.stage, "provisional")));

  if (pending.length === 0) {
    // 伝票を経由しない手入力の仮原価は、紐づけの対象外なのでそのまま待ちに数える
    return items.filter((i) => !i.invoiceNumber).reduce((s, i) => s + parseN(i.amount), 0);
  }
  const numbers = new Set(pending.map((p) => p.voucherNumber));
  return items
    .filter((i) => !i.invoiceNumber || numbers.has(i.invoiceNumber))
    .reduce((s, i) => s + parseN(i.amount), 0);
}

export default router;
