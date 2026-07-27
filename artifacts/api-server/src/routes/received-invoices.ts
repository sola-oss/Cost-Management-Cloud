import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, ne } from "drizzle-orm";
import {
  db,
  receivedInvoicesTable,
  receivedInvoiceItemsTable,
  receivedInvoiceRecipientsTable,
  staffMembersTable,
} from "@workspace/db";
import type { ReceivedInvoiceStatus } from "@workspace/db";
import {
  uploadInvoiceFile,
  getSignedUrl,
  readLocalFile,
  deleteInvoiceFile,
  storageMode,
} from "../lib/invoice-storage";

const router: IRouter = Router();

function parseN(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) || 0 : ((v as number) ?? 0);
}

// crypto.randomUUID は Node 18+ で global
function newKey(mediaType: string): string {
  const ext =
    mediaType === "application/pdf" ? "pdf"
    : mediaType === "image/png" ? "png"
    : mediaType === "image/jpeg" ? "jpg"
    : mediaType === "image/webp" ? "webp"
    : mediaType === "image/gif" ? "gif"
    : "bin";
  const now = new Date();
  const ym = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `${ym}/${crypto.randomUUID()}.${ext}`;
}

// ── 明細をブロック化する（伝票番号でまとめる。無ければ1行=1ブロック）──────────
interface ItemRow {
  id: number;
  receivedInvoiceId: number;
  lineNumber: number;
  slipNo: string | null;
  deliveryDate: string | null;
  deliveryTo: string | null;
  category: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  taxRate: string;
  projectId: number | null;
  isNonPurchase: boolean;
}

function fmtItem(i: ItemRow) {
  return {
    id: i.id,
    lineNumber: i.lineNumber,
    slipNo: i.slipNo,
    deliveryDate: i.deliveryDate,
    deliveryTo: i.deliveryTo,
    category: i.category,
    description: i.description,
    quantity: parseN(i.quantity),
    unit: i.unit,
    unitPrice: parseN(i.unitPrice),
    amount: parseN(i.amount),
    taxRate: parseN(i.taxRate),
    projectId: i.projectId,
    isNonPurchase: i.isNonPurchase,
  };
}

function buildBlocks(items: ItemRow[]) {
  const order: string[] = [];
  const groups = new Map<string, ItemRow[]>();
  for (const it of [...items].sort((a, b) => a.lineNumber - b.lineNumber)) {
    const key = it.slipNo && it.slipNo.trim() ? `slip:${it.slipNo.trim()}` : `line:${it.id}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(it);
  }
  return order.map((key) => {
    const lines = groups.get(key)!;
    const purchaseLines = lines.filter((l) => !l.isNonPurchase);
    const projectIds = new Set(purchaseLines.map((l) => l.projectId).filter((x): x is number => x != null));
    return {
      key,
      slipNo: lines[0].slipNo || null,
      deliveryDate: lines[0].deliveryDate || null,
      deliveryTo: lines[0].deliveryTo || null,
      amount: lines.reduce((s, l) => s + parseN(l.amount), 0),
      lineCount: lines.length,
      lines: lines.map(fmtItem),
      itemIds: purchaseLines.map((l) => l.id),
      // ブロックの割当工事：仕入行が1つの工事で揃っていればそのID。未割当・混在なら null
      projectId: projectIds.size === 1 ? [...projectIds][0] : null,
      hasNonPurchase: lines.some((l) => l.isNonPurchase),
      allPurchaseAssigned: purchaseLines.length > 0 && purchaseLines.every((l) => l.projectId != null),
    };
  });
}

// 未割当額 = 仕入行(isNonPurchase=false)で工事未設定の金額合計
function unassignedAmount(items: ItemRow[]): number {
  return items
    .filter((i) => !i.isNonPurchase && i.projectId == null)
    .reduce((s, i) => s + parseN(i.amount), 0);
}

// ── POST /  受領請求書を作成（AI抽出の下書き or 手入力から）────────────────────
// body: { vendorId?, vendorName, invoiceDate?, paymentDueDate?, subtotal, taxAmount,
//         totalAmount, aiExtracted, amountMismatch, notes?, fileBase64?, mediaType?,
//         items: [{ slipNo?, deliveryDate?, deliveryTo?, category, description,
//                   quantity, unit, unitPrice, amount, taxRate, isNonPurchase }] }
router.post("/", async (req, res) => {
  try {
    const b = req.body as {
      vendorId?: number | null;
      vendorName?: string;
      invoiceDate?: string | null;
      paymentDueDate?: string | null;
      subtotal?: number;
      taxAmount?: number;
      totalAmount?: number;
      aiExtracted?: boolean;
      amountMismatch?: boolean;
      notes?: string | null;
      fileBase64?: string;
      mediaType?: string;
      items?: Array<Record<string, unknown>>;
    };
    const items = Array.isArray(b.items) ? b.items : [];

    // 画像があれば先に保存（DBに入れる前に。失敗したら中断）
    let filePath: string | null = null;
    if (b.fileBase64) {
      const media = b.mediaType ?? "application/pdf";
      filePath = newKey(media);
      await uploadInvoiceFile(filePath, b.fileBase64, media);
    }

    const created = await db.transaction(async (tx) => {
      const [inv] = await tx
        .insert(receivedInvoicesTable)
        .values({
          vendorId: b.vendorId ?? null,
          vendorName: b.vendorName ?? "",
          invoiceDate: b.invoiceDate || null,
          paymentDueDate: b.paymentDueDate || null,
          status: "draft",
          aiExtracted: b.aiExtracted ?? false,
          amountMismatch: b.amountMismatch ?? false,
          filePath,
          mediaType: b.fileBase64 ? (b.mediaType ?? "application/pdf") : null,
          subtotal: String(b.subtotal ?? 0),
          taxAmount: String(b.taxAmount ?? 0),
          totalAmount: String(b.totalAmount ?? 0),
          notes: b.notes ?? null,
        })
        .returning();

      if (items.length > 0) {
        await tx.insert(receivedInvoiceItemsTable).values(
          items.map((it, idx) => ({
            receivedInvoiceId: inv.id,
            lineNumber: (it["lineNumber"] as number) ?? idx + 1,
            slipNo: (it["slipNo"] as string) || null,
            deliveryDate: (it["deliveryDate"] as string) || null,
            deliveryTo: (it["deliveryTo"] as string) || null,
            category: ((it["category"] as string) ?? "material") as "material" | "labor" | "subcontract" | "expense",
            description: (it["description"] as string) ?? "",
            quantity: String(it["quantity"] ?? 1),
            unit: (it["unit"] as string) ?? "",
            unitPrice: String(it["unitPrice"] ?? 0),
            amount: String(it["amount"] ?? 0),
            taxRate: String(it["taxRate"] ?? 10),
            isNonPurchase: Boolean(it["isNonPurchase"]),
          })),
        );
      }
      return inv;
    });

    return res.status(201).json({ id: created.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create received invoice");
    return res.status(500).json({ message: "受領請求書の作成に失敗しました。" });
  }
});

// ── GET /  未回答一覧（事務用）──────────────────────────────────────────────
// ?status= でフィルタ（省略時は cancelled 以外すべて）
router.get("/", async (req, res) => {
  try {
    const statusFilter = req.query["status"] as string | undefined;

    const invoices = await db
      .select()
      .from(receivedInvoicesTable)
      .where(statusFilter ? eq(receivedInvoicesTable.status, statusFilter as ReceivedInvoiceStatus) : ne(receivedInvoicesTable.status, "cancelled"))
      .orderBy(desc(receivedInvoicesTable.createdAt));

    if (invoices.length === 0) return res.json({ items: [] });

    const ids = invoices.map((i) => i.id);
    const allItems = await db
      .select()
      .from(receivedInvoiceItemsTable)
      .where(inArray(receivedInvoiceItemsTable.receivedInvoiceId, ids));
    const recips = await db
      .select({
        receivedInvoiceId: receivedInvoiceRecipientsTable.receivedInvoiceId,
        staffMemberId: receivedInvoiceRecipientsTable.staffMemberId,
        respondedAt: receivedInvoiceRecipientsTable.respondedAt,
        name: staffMembersTable.name,
      })
      .from(receivedInvoiceRecipientsTable)
      .innerJoin(staffMembersTable, eq(receivedInvoiceRecipientsTable.staffMemberId, staffMembersTable.id))
      .where(inArray(receivedInvoiceRecipientsTable.receivedInvoiceId, ids));

    const itemsByInv = new Map<number, ItemRow[]>();
    for (const it of allItems as unknown as ItemRow[]) {
      const arr = itemsByInv.get(it.receivedInvoiceId) ?? [];
      arr.push(it);
      itemsByInv.set(it.receivedInvoiceId, arr);
    }
    const recipsByInv = new Map<number, typeof recips>();
    for (const r of recips) {
      const arr = recipsByInv.get(r.receivedInvoiceId) ?? [];
      arr.push(r);
      recipsByInv.set(r.receivedInvoiceId, arr);
    }

    const out = invoices.map((inv) => {
      const its = itemsByInv.get(inv.id) ?? [];
      const blocks = buildBlocks(its);
      const assignedBlocks = blocks.filter((bk) => bk.allPurchaseAssigned || bk.itemIds.length === 0).length;
      return {
        id: inv.id,
        vendorId: inv.vendorId,
        vendorName: inv.vendorName,
        invoiceDate: inv.invoiceDate,
        paymentDueDate: inv.paymentDueDate,
        status: inv.status,
        amountMismatch: inv.amountMismatch,
        totalAmount: parseN(inv.totalAmount),
        unassignedAmount: unassignedAmount(its),
        blockCount: blocks.length,
        assignedBlockCount: assignedBlocks,
        sentAt: inv.sentAt,
        createdAt: inv.createdAt,
        recipients: (recipsByInv.get(inv.id) ?? []).map((r) => ({
          staffMemberId: r.staffMemberId,
          name: r.name,
          respondedAt: r.respondedAt,
        })),
      };
    });

    return res.json({ items: out });
  } catch (err) {
    req.log.error({ err }, "Failed to list received invoices");
    return res.status(500).json({ message: "一覧の取得に失敗しました。" });
  }
});

// ── GET /:id  詳細（現場担当者の割当画面・事務の確認用）────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "不正なIDです" });

    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });

    const items = (await db
      .select()
      .from(receivedInvoiceItemsTable)
      .where(eq(receivedInvoiceItemsTable.receivedInvoiceId, id))) as unknown as ItemRow[];

    const recips = await db
      .select({
        staffMemberId: receivedInvoiceRecipientsTable.staffMemberId,
        respondedAt: receivedInvoiceRecipientsTable.respondedAt,
        name: staffMembersTable.name,
      })
      .from(receivedInvoiceRecipientsTable)
      .innerJoin(staffMembersTable, eq(receivedInvoiceRecipientsTable.staffMemberId, staffMembersTable.id))
      .where(eq(receivedInvoiceRecipientsTable.receivedInvoiceId, id));

    return res.json({
      id: inv.id,
      vendorId: inv.vendorId,
      vendorName: inv.vendorName,
      invoiceDate: inv.invoiceDate,
      paymentDueDate: inv.paymentDueDate,
      status: inv.status,
      aiExtracted: inv.aiExtracted,
      amountMismatch: inv.amountMismatch,
      subtotal: parseN(inv.subtotal),
      taxAmount: parseN(inv.taxAmount),
      totalAmount: parseN(inv.totalAmount),
      notes: inv.notes,
      hasFile: !!inv.filePath,
      blocks: buildBlocks(items),
      unassignedAmount: unassignedAmount(items),
      recipients: recips,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get received invoice");
    return res.status(500).json({ message: "取得に失敗しました。" });
  }
});

// ── GET /:id/file  原本画像（本番=署名URLへリダイレクト / ローカル=そのまま配信）──
router.get("/:id/file", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [inv] = await db
      .select({ filePath: receivedInvoicesTable.filePath, mediaType: receivedInvoicesTable.mediaType })
      .from(receivedInvoicesTable)
      .where(eq(receivedInvoicesTable.id, id));
    if (!inv?.filePath) return res.status(404).json({ message: "原本がありません" });

    if (storageMode === "supabase") {
      const url = await getSignedUrl(inv.filePath);
      if (!url) return res.status(502).json({ message: "URLの発行に失敗しました" });
      return res.redirect(url);
    }
    const buf = await readLocalFile(inv.filePath);
    if (!buf) return res.status(404).json({ message: "ファイルが見つかりません" });
    res.setHeader("Content-Type", inv.mediaType ?? "application/octet-stream");
    return res.end(buf);
  } catch (err) {
    req.log.error({ err }, "Failed to serve invoice file");
    return res.status(500).json({ message: "ファイルの取得に失敗しました。" });
  }
});

// ── POST /:id/send  送り先を指定して現場に送信（複数可・事務が選ぶ）──────────────
// body: { staffMemberIds: number[] }
router.post("/:id/send", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const staffMemberIds = (req.body?.staffMemberIds ?? []) as number[];
    if (!Array.isArray(staffMemberIds) || staffMemberIds.length === 0) {
      return res.status(400).json({ message: "送り先を1名以上選んでください。" });
    }

    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status === "confirmed" || inv.status === "cancelled") {
      return res.status(409).json({ message: "この請求書は送信できない状態です。" });
    }

    await db.transaction(async (tx) => {
      // 送り先を貼り直す（重複送信を避けるため一旦消してから入れる）
      await tx.delete(receivedInvoiceRecipientsTable).where(eq(receivedInvoiceRecipientsTable.receivedInvoiceId, id));
      await tx.insert(receivedInvoiceRecipientsTable).values(
        staffMemberIds.map((sid) => ({ receivedInvoiceId: id, staffMemberId: sid })),
      );
      await tx
        .update(receivedInvoicesTable)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(receivedInvoicesTable.id, id));
    });

    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to send received invoice");
    return res.status(500).json({ message: "送信に失敗しました。" });
  }
});

// ── PATCH /:id/assign  明細に工事を割り当てる（現場担当者）──────────────────────
// body: { assignments: [{ itemId, projectId | null }] }
router.patch("/:id/assign", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const assignments = (req.body?.assignments ?? []) as Array<{ itemId: number; projectId: number | null }>;
    if (!Array.isArray(assignments)) return res.status(400).json({ message: "assignments が不正です" });

    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status === "confirmed" || inv.status === "cancelled") {
      return res.status(409).json({ message: "確定済み/取消済みのため変更できません。" });
    }

    await db.transaction(async (tx) => {
      for (const a of assignments) {
        await tx
          .update(receivedInvoiceItemsTable)
          .set({ projectId: a.projectId ?? null, updatedAt: new Date() })
          .where(and(eq(receivedInvoiceItemsTable.id, a.itemId), eq(receivedInvoiceItemsTable.receivedInvoiceId, id)));
      }
    });

    const items = (await db
      .select()
      .from(receivedInvoiceItemsTable)
      .where(eq(receivedInvoiceItemsTable.receivedInvoiceId, id))) as unknown as ItemRow[];

    return res.json({ blocks: buildBlocks(items), unassignedAmount: unassignedAmount(items) });
  } catch (err) {
    req.log.error({ err }, "Failed to assign received invoice items");
    return res.status(500).json({ message: "割当の保存に失敗しました。" });
  }
});

// ── POST /:id/respond  現場担当者の回答送信（全割当済なら answered へ）───────────
// body: { staffMemberId? }
router.post("/:id/respond", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const staffMemberId = req.body?.staffMemberId as number | undefined;

    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });

    const items = (await db
      .select()
      .from(receivedInvoiceItemsTable)
      .where(eq(receivedInvoiceItemsTable.receivedInvoiceId, id))) as unknown as ItemRow[];
    const remaining = unassignedAmount(items);
    if (remaining !== 0) {
      return res.status(400).json({ message: "未割当が残っています。すべての明細に工事を割り当ててください。", unassignedAmount: remaining });
    }

    await db.transaction(async (tx) => {
      if (staffMemberId) {
        await tx
          .update(receivedInvoiceRecipientsTable)
          .set({ respondedAt: new Date() })
          .where(and(
            eq(receivedInvoiceRecipientsTable.receivedInvoiceId, id),
            eq(receivedInvoiceRecipientsTable.staffMemberId, staffMemberId),
          ));
      }
      // 全割当済 → answered（事務の確認待ち）
      await tx
        .update(receivedInvoicesTable)
        .set({ status: "answered", updatedAt: new Date() })
        .where(eq(receivedInvoicesTable.id, id));
    });

    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to respond received invoice");
    return res.status(500).json({ message: "送信に失敗しました。" });
  }
});

// ── POST /:id/confirm  事務が確定（→ 工事ごとに仕入伝票を生成：タスク#5で実装）──
router.post("/:id/confirm", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status === "confirmed") return res.status(409).json({ message: "すでに確定済みです。" });

    const items = (await db
      .select()
      .from(receivedInvoiceItemsTable)
      .where(eq(receivedInvoiceItemsTable.receivedInvoiceId, id))) as unknown as ItemRow[];
    const remaining = unassignedAmount(items);
    if (remaining !== 0) {
      return res.status(400).json({ message: "未割当が残っているため確定できません。", unassignedAmount: remaining });
    }

    // TODO(#5): 工事ごとにグループ化して purchase_invoices を生成する。
    // ここでは状態だけ進める（生成処理は次タスクで confirm 内に実装）。
    await db
      .update(receivedInvoicesTable)
      .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(receivedInvoicesTable.id, id));

    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to confirm received invoice");
    return res.status(500).json({ message: "確定に失敗しました。" });
  }
});

// ── DELETE /:id  取消（原本ファイルも消す）──────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status === "confirmed") {
      return res.status(409).json({ message: "確定済みは取り消せません。" });
    }
    if (inv.filePath) await deleteInvoiceFile(inv.filePath);
    await db.delete(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete received invoice");
    return res.status(500).json({ message: "削除に失敗しました。" });
  }
});

export default router;
