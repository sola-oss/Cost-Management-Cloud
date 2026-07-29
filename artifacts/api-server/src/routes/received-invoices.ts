import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, ne } from "drizzle-orm";
import {
  db,
  receivedInvoicesTable,
  receivedInvoiceItemsTable,
  receivedInvoiceRecipientsTable,
  staffMembersTable,
  vendorsTable,
  purchaseInvoicesTable,
  purchaseInvoiceItemsTable,
} from "@workspace/db";
import type { ReceivedInvoiceStatus } from "@workspace/db";
import {
  uploadInvoiceFile,
  getSignedUrl,
  readLocalFile,
  deleteInvoiceFile,
  storageMode,
} from "../lib/invoice-storage";
import { withUniqueNumberTransaction } from "../lib/unique-number";
import {
  generateVoucherNumber,
  syncCostItemsAfterInvoice,
  calcTotals,
} from "../lib/purchase-invoice-create";

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
  workTypeId: number | null;
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
    workTypeId: i.workTypeId,
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

// 未割当の行数。金額0円の行が未割当でも「未割当額0」になってしまうため、
// 送信・確定の可否は金額ではなく行数で判定する（0円行が原価から静かに漏れるのを防ぐ）。
function unassignedCount(items: ItemRow[]): number {
  return items.filter((i) => !i.isNonPurchase && i.projectId == null).length;
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
            workTypeId: (it["workTypeId"] as number) ?? null,
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
    // 現場担当者の「受信」用。自分が送り先になっているものだけを返す。
    const forStaff = req.query["staffMemberId"] ? Number(req.query["staffMemberId"]) : null;

    const baseWhere = statusFilter
      ? eq(receivedInvoicesTable.status, statusFilter as ReceivedInvoiceStatus)
      : ne(receivedInvoicesTable.status, "cancelled");

    let invoices;
    if (forStaff && Number.isInteger(forStaff)) {
      const mine = await db
        .select({ id: receivedInvoiceRecipientsTable.receivedInvoiceId })
        .from(receivedInvoiceRecipientsTable)
        .where(eq(receivedInvoiceRecipientsTable.staffMemberId, forStaff));
      const myIds = mine.map((m) => m.id);
      invoices = myIds.length === 0 ? [] : await db
        .select()
        .from(receivedInvoicesTable)
        .where(and(baseWhere, inArray(receivedInvoicesTable.id, myIds)))
        .orderBy(desc(receivedInvoicesTable.createdAt));
    } else {
      invoices = await db
        .select()
        .from(receivedInvoicesTable)
        .where(baseWhere)
        .orderBy(desc(receivedInvoicesTable.createdAt));
    }

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
      // 進捗は仕入ブロックだけで数える（入金・値引などの非仕入ブロックは分母にも入れない）
      const blocks = buildBlocks(its).filter((bk) => bk.itemIds.length > 0);
      const assignedBlocks = blocks.filter((bk) => bk.allPurchaseAssigned).length;
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
        unassignedCount: unassignedCount(its),
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
      unassignedCount: unassignedCount(items),
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

    return res.json({
      blocks: buildBlocks(items),
      unassignedAmount: unassignedAmount(items),
      unassignedCount: unassignedCount(items),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to assign received invoice items");
    return res.status(500).json({ message: "割当の保存に失敗しました。" });
  }
});

// ── PATCH /:id/vendor  仕入先を確定する（AI抽出で未確定だった場合に事務が選ぶ）────
router.patch("/:id/vendor", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const vendorId = Number(req.body?.vendorId);
    if (!Number.isInteger(vendorId)) return res.status(400).json({ message: "vendorId が不正です" });

    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status === "confirmed") return res.status(409).json({ message: "確定済みのため変更できません。" });

    const [v] = await db.select({ name: vendorsTable.name }).from(vendorsTable).where(eq(vendorsTable.id, vendorId));
    if (!v) return res.status(400).json({ message: "その仕入先は存在しません。" });

    await db
      .update(receivedInvoicesTable)
      .set({ vendorId, updatedAt: new Date() })
      .where(eq(receivedInvoicesTable.id, id));

    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to set vendor");
    return res.status(500).json({ message: "仕入先の保存に失敗しました。" });
  }
});

// ── PATCH /:id  事務が中身を直す（下書きのみ）────────────────────────────────
//
// AIの読み違い（日付・金額・品名）と、AIが判断できない科目・工種をここで整える。
// 現場に送る前に事務が確かめる、という順番を成り立たせるための入口。
// 送信後（sent以降）を対象にしないのは、現場が付けた工事の割当を壊さないため。
//
// body: { invoiceDate?, paymentDueDate?, totalAmount?,
//         items?: [{ id?, slipNo, deliveryDate, deliveryTo, category, workTypeId,
//                    description, quantity, unit, unitPrice, amount, taxRate, isNonPurchase }] }
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "不正なIDです" });

    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status !== "draft") {
      return res.status(409).json({ message: "現場に送ったあとは中身を変更できません。" });
    }

    const b = req.body as {
      invoiceDate?: string | null;
      paymentDueDate?: string | null;
      totalAmount?: number;
      items?: Array<Record<string, unknown>>;
    };

    await db.transaction(async (tx) => {
      if (Array.isArray(b.items)) {
        const existing = await tx
          .select({ id: receivedInvoiceItemsTable.id })
          .from(receivedInvoiceItemsTable)
          .where(eq(receivedInvoiceItemsTable.receivedInvoiceId, id));
        const existingIds = new Set(existing.map((e) => e.id));
        const keptIds = new Set<number>();

        for (const [idx, it] of b.items.entries()) {
          const values = {
            lineNumber: idx + 1,
            slipNo: (it["slipNo"] as string) || null,
            deliveryDate: (it["deliveryDate"] as string) || null,
            deliveryTo: (it["deliveryTo"] as string) || null,
            category: ((it["category"] as string) ?? "material") as "material" | "labor" | "subcontract" | "expense",
            workTypeId: (it["workTypeId"] as number) ?? null,
            description: (it["description"] as string) ?? "",
            quantity: String(it["quantity"] ?? 1),
            unit: (it["unit"] as string) ?? "",
            unitPrice: String(it["unitPrice"] ?? 0),
            amount: String(it["amount"] ?? 0),
            taxRate: String(it["taxRate"] ?? 10),
            isNonPurchase: Boolean(it["isNonPurchase"]),
            updatedAt: new Date(),
          };
          const itemId = Number(it["id"]);
          // 既存行は更新して id を保つ（現場・事務が付けた工事の割当を残すため）
          if (Number.isInteger(itemId) && existingIds.has(itemId)) {
            keptIds.add(itemId);
            await tx.update(receivedInvoiceItemsTable).set(values).where(eq(receivedInvoiceItemsTable.id, itemId));
          } else {
            await tx.insert(receivedInvoiceItemsTable).values({ receivedInvoiceId: id, ...values });
          }
        }

        const removed = [...existingIds].filter((x) => !keptIds.has(x));
        if (removed.length > 0) {
          await tx.delete(receivedInvoiceItemsTable).where(inArray(receivedInvoiceItemsTable.id, removed));
        }
      }

      // 合計を明細から引き直す。請求額（原本に印字された今回ご請求額）は人が入れた値を
      // 正とし、明細から計算した額とズレたときだけ警告を立てる。
      const items = (await tx
        .select()
        .from(receivedInvoiceItemsTable)
        .where(eq(receivedInvoiceItemsTable.receivedInvoiceId, id))) as unknown as ItemRow[];
      const purchase = items.filter((i) => !i.isNonPurchase);
      const subtotal = purchase.reduce((s, i) => s + parseN(i.amount), 0);
      const taxAmount = Math.floor(purchase.reduce((s, i) => s + parseN(i.amount) * (parseN(i.taxRate) / 100), 0));
      const adjust = items.filter((i) => i.isNonPurchase).reduce((s, i) => s + parseN(i.amount), 0);
      const totalAmount = b.totalAmount !== undefined ? Number(b.totalAmount) : parseN(inv.totalAmount);
      const computed = subtotal + taxAmount + adjust;
      const tolerance = Math.max(Math.round(Math.abs(computed) * 0.005), 100);
      const amountMismatch = Math.abs(computed - totalAmount) > tolerance;

      await tx
        .update(receivedInvoicesTable)
        .set({
          ...(b.invoiceDate !== undefined ? { invoiceDate: b.invoiceDate || null } : {}),
          ...(b.paymentDueDate !== undefined ? { paymentDueDate: b.paymentDueDate || null } : {}),
          subtotal: String(subtotal),
          taxAmount: String(taxAmount),
          totalAmount: String(totalAmount),
          amountMismatch,
          updatedAt: new Date(),
        })
        .where(eq(receivedInvoicesTable.id, id));
    });

    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update received invoice");
    return res.status(500).json({ message: "保存に失敗しました。" });
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
    if (unassignedCount(items) > 0) {
      return res.status(400).json({
        message: "未割当が残っています。すべての明細に工事を割り当ててください。",
        unassignedAmount: unassignedAmount(items),
        unassignedCount: unassignedCount(items),
      });
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

// ── POST /:id/confirm  事務が確定 → 工事ごとに仕入伝票を生成 ────────────────────
//
// 1枚の受領請求書を、明細の工事でグループ化して purchase_invoices をN件作る。
// purchase_invoices.projectId は notNull なので分割が必須。生成した各伝票には
// receivedInvoiceId を持たせ、原本1枚に戻せるようにする。
// 支払は会計ソフト側なので payments は作らない（原価だけ立てる）。
router.post("/:id/confirm", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status === "confirmed") return res.status(409).json({ message: "すでに確定済みです。" });
    if (inv.status === "cancelled") return res.status(409).json({ message: "取消済みのため確定できません。" });
    if (!inv.vendorId) {
      return res.status(400).json({ message: "仕入先が未設定です。仕入先を選んでから確定してください。" });
    }

    const items = (await db
      .select()
      .from(receivedInvoiceItemsTable)
      .where(eq(receivedInvoiceItemsTable.receivedInvoiceId, id))) as unknown as ItemRow[];
    if (unassignedCount(items) > 0) {
      return res.status(400).json({
        message: "未割当が残っているため確定できません。",
        unassignedAmount: unassignedAmount(items),
        unassignedCount: unassignedCount(items),
      });
    }

    // 仕入行のみを対象にする（入金・繰越・値引・小計などの非仕入行は原価に立てない）
    const purchaseItems = items.filter((i) => !i.isNonPurchase && i.projectId != null);
    if (purchaseItems.length === 0) {
      return res.status(400).json({ message: "原価に計上できる明細がありません。" });
    }

    const [vendorRow] = await db
      .select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, inv.vendorId));
    const vendorName = vendorRow?.name ?? inv.vendorName ?? "（仕入先）";
    const purchaseDate = inv.invoiceDate ?? new Date().toISOString().slice(0, 10);

    // 工事ごとにグループ化
    const byProject = new Map<number, ItemRow[]>();
    for (const it of purchaseItems) {
      const pid = it.projectId as number;
      const arr = byProject.get(pid) ?? [];
      arr.push(it);
      byProject.set(pid, arr);
    }

    const created: Array<{ projectId: number; voucherNumber: string; totalAmount: number }> = [];

    // 工事ごとに1件ずつ採番して作る（採番衝突はトランザクション単位でリトライ）
    for (const [projectId, group] of byProject) {
      const lines = group
        .sort((a, b) => a.lineNumber - b.lineNumber)
        .map((l) => ({ ...l, amountN: parseN(l.amount), taxRateN: parseN(l.taxRate) }));
      const totals = calcTotals(lines.map((l) => ({ amount: l.amountN, taxRate: l.taxRateN })));

      const madeVoucher = await withUniqueNumberTransaction(
        generateVoucherNumber,
        async (voucherNumber, tx) => {
          const [pi] = await tx
            .insert(purchaseInvoicesTable)
            .values({
              voucherNumber,
              projectId,
              vendorId: inv.vendorId as number,
              receivedInvoiceId: inv.id,
              purchaseDate,
              paymentDueDate: inv.paymentDueDate ?? null,
              status: "confirmed",
              isProvisional: false,
              subtotal: String(totals.subtotal),
              taxAmount: String(totals.taxAmount),
              totalAmount: String(totals.totalAmount),
              notes: `仮デジタル請求書 #${inv.id}（${vendorName}）から生成`,
            })
            .returning();

          const insertedItems = await tx
            .insert(purchaseInvoiceItemsTable)
            .values(
              lines.map((l, idx) => ({
                purchaseInvoiceId: pi.id,
                lineNumber: idx + 1,
                category: l.category as "material" | "labor" | "subcontract" | "expense",
                // 工種を引き継ぐ。ここが抜けると原価が工種別の予算残から漏れる。
                workTypeId: l.workTypeId,
                description: l.description,
                // 納品書番号・納品先を摘要に残す（あとから原本を追える）
                specification: [l.slipNo ? `伝票${l.slipNo}` : null, l.deliveryTo || null]
                  .filter(Boolean)
                  .join(" ") || null,
                quantity: String(l.quantity),
                unit: l.unit,
                unitPrice: String(l.unitPrice),
                amount: String(l.amount),
                taxRate: String(l.taxRate),
              })),
            )
            .returning();

          await syncCostItemsAfterInvoice(
            tx,
            projectId,
            purchaseDate,
            voucherNumber,
            false,
            vendorName,
            inv.vendorId as number,
            insertedItems,
          );

          return voucherNumber;
        },
      );

      created.push({ projectId, voucherNumber: madeVoucher, totalAmount: totals.totalAmount });
    }

    await db
      .update(receivedInvoicesTable)
      .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(receivedInvoicesTable.id, id));

    return res.json({ ok: true, created });
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
