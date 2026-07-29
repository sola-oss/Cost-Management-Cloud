import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, ne, sql, isNull, isNotNull } from "drizzle-orm";
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
  deleteCostItemsByInvoiceId,
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
  lockedAt: Date | null;
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
    locked: i.lockedAt != null,
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
      // 誰かが「返す」を押して固定された分。あとから他の人に書き換えられないようにする。
      locked: purchaseLines.length > 0 && purchaseLines.every((l) => l.lockedAt != null),
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
// ?scope=open で確定前（下書き・未回答・確認待ち）だけに絞る
// ?limit= で件数を制限（既定300）。使い続けると確定済がたまり、全件返すのが重くなるため。
router.get("/", async (req, res) => {
  try {
    const statusFilter = req.query["status"] as string | undefined;
    const scope = req.query["scope"] as string | undefined;
    // 現場担当者の「受信」用。自分が送り先になっているものだけを返す。
    const forStaff = req.query["staffMemberId"] ? Number(req.query["staffMemberId"]) : null;
    const limitParam = Number(req.query["limit"]);
    const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 300;

    const baseWhere = statusFilter
      ? eq(receivedInvoicesTable.status, statusFilter as ReceivedInvoiceStatus)
      : scope === "open"
        ? inArray(receivedInvoicesTable.status, ["draft", "sent", "answered"])
        : ne(receivedInvoicesTable.status, "cancelled");

    // 並び順は「手を動かす必要がある順」。確定済は後ろへ回し、確定前は支払期日の近い順。
    // 期日の無いものは最後（画面の見出し「支払期日が近い順」と実際の並びを合わせる）。
    const orderBy = [
      sql`case when ${receivedInvoicesTable.status} = 'confirmed' then 1 else 0 end asc`,
      sql`${receivedInvoicesTable.paymentDueDate} asc nulls last`,
      desc(receivedInvoicesTable.createdAt),
    ];

    let rows;
    if (forStaff && Number.isInteger(forStaff)) {
      const mine = await db
        .select({ id: receivedInvoiceRecipientsTable.receivedInvoiceId })
        .from(receivedInvoiceRecipientsTable)
        .where(eq(receivedInvoiceRecipientsTable.staffMemberId, forStaff));
      const myIds = mine.map((m) => m.id);
      rows = myIds.length === 0 ? [] : await db
        .select()
        .from(receivedInvoicesTable)
        .where(and(baseWhere, inArray(receivedInvoicesTable.id, myIds)))
        .orderBy(...orderBy)
        .limit(limit + 1);
    } else {
      rows = await db
        .select()
        .from(receivedInvoicesTable)
        .where(baseWhere)
        .orderBy(...orderBy)
        .limit(limit + 1);
    }

    // 1件多く取って、続きがあるかを画面に知らせる（黙って切り捨てない）
    const hasMore = rows.length > limit;
    const invoices = hasMore ? rows.slice(0, limit) : rows;

    if (invoices.length === 0) return res.json({ items: [], hasMore: false });

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

    return res.json({ items: out, hasMore });
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

    // ── 二重取り込みの検知 ───────────────────────────────────────────────
    // 同じ請求書をもう一度取り込んでも今までは何も言わなかった。確定すると原価が
    // そのまま倍になる。同じ仕入先・同じ請求日・同じ請求額を「疑わしい」として出す。
    // 同額の請求が別々に届くこともあるので、止めはしない（警告だけ）。
    const duplicates =
      inv.vendorId && inv.invoiceDate
        ? await db
            .select({
              id: receivedInvoicesTable.id,
              status: receivedInvoicesTable.status,
              createdAt: receivedInvoicesTable.createdAt,
            })
            .from(receivedInvoicesTable)
            .where(and(
              ne(receivedInvoicesTable.id, id),
              eq(receivedInvoicesTable.vendorId, inv.vendorId),
              eq(receivedInvoicesTable.invoiceDate, inv.invoiceDate),
              eq(receivedInvoicesTable.totalAmount, inv.totalAmount),
              ne(receivedInvoicesTable.status, "cancelled"),
            ))
            .orderBy(desc(receivedInvoicesTable.createdAt))
        : [];

    return res.json({
      id: inv.id,
      vendorId: inv.vendorId,
      vendorName: inv.vendorName,
      duplicates,
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
// body: { assignments: [{ itemId, projectId | null }], staffMemberId? }
router.patch("/:id/assign", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const assignments = (req.body?.assignments ?? []) as Array<{ itemId: number; projectId: number | null }>;
    // 誰が選んだかを残す。「返す」でその人の分だけを固定するために使う。
    const staffMemberId = req.body?.staffMemberId as number | undefined;
    if (!Array.isArray(assignments)) return res.status(400).json({ message: "assignments が不正です" });

    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status === "confirmed" || inv.status === "cancelled") {
      return res.status(409).json({ message: "確定済み/取消済みのため変更できません。" });
    }
    // 現場から返ってきたあとは動かせない。事務が見た内容と確定される内容が
    // ずれるのを防ぐため。直すときは差し戻して現場に選び直してもらう。
    if (inv.status === "answered") {
      return res.status(409).json({ message: "現場から返ってきた書類は変更できません。直すときは差し戻してください。" });
    }

    // 返答済みの分（固定された行）は、まだ書類全体が未回答でも書き換えさせない。
    // 1枚を複数の現場で分けるとき、先に返した人の回答が黙って差し替わるのを防ぐ。
    const targetIds = assignments.map((a) => a.itemId).filter((x) => Number.isInteger(x));
    if (targetIds.length > 0) {
      const locked = await db
        .select({ id: receivedInvoiceItemsTable.id })
        .from(receivedInvoiceItemsTable)
        .where(and(
          eq(receivedInvoiceItemsTable.receivedInvoiceId, id),
          inArray(receivedInvoiceItemsTable.id, targetIds),
          isNotNull(receivedInvoiceItemsTable.lockedAt),
        ));
      if (locked.length > 0) {
        return res.status(409).json({
          message: "この明細は担当者が回答済みのため変更できません。直すときは事務に差し戻してもらってください。",
        });
      }
    }

    await db.transaction(async (tx) => {
      for (const a of assignments) {
        await tx
          .update(receivedInvoiceItemsTable)
          .set({
            projectId: a.projectId ?? null,
            assignedByStaffId: a.projectId == null ? null : (staffMemberId ?? null),
            updatedAt: new Date(),
          })
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

// ── POST /:id/respond  現場担当者の回答送信 ────────────────────────────────────
//
// 1枚の請求書が複数の現場にまたがると、自分の分を選び終えても他人の分が残るため、
// 「全ブロック埋まるまで誰も返せない」状態になっていた。誰かが他人の現場まで
// 当てずっぽうで選ぶか、全員が待ち続けるかの二択になる。
// そこで、自分の分だけ返せるようにする。回答した事実は担当者ごとに記録し、
// 書類が「確認待ち（answered）」に進むのは全ブロックが埋まったときだけにする。
//
// body: { staffMemberId? }
router.post("/:id/respond", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const staffMemberId = req.body?.staffMemberId as number | undefined;

    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status === "confirmed" || inv.status === "cancelled") {
      return res.status(409).json({ message: "この請求書は回答できない状態です。" });
    }

    const items = (await db
      .select()
      .from(receivedInvoiceItemsTable)
      .where(eq(receivedInvoiceItemsTable.receivedInvoiceId, id))) as unknown as ItemRow[];
    const remaining = unassignedCount(items);

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
      // 返した人の回答をここで確定させ、あとから他の人に書き換えられないようにする。
      // 全部埋まった（＝これで確認待ちに上がる）ときは全行、途中のときは
      // 「その人が選んだ行」だけを固定する。他の人が選択中の行まで巻き込むと、
      // 選び直せないまま固まってしまうため。
      await tx
        .update(receivedInvoiceItemsTable)
        .set({ lockedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(receivedInvoiceItemsTable.receivedInvoiceId, id),
          isNotNull(receivedInvoiceItemsTable.projectId),
          isNull(receivedInvoiceItemsTable.lockedAt),
          ...(remaining === 0 || !staffMemberId
            ? []
            : [eq(receivedInvoiceItemsTable.assignedByStaffId, staffMemberId)]),
        ));
      // 全部埋まったときだけ事務の確認待ちへ進める。残っていれば sent のまま、
      // 他の担当者が続きを選べる状態を保つ。
      if (remaining === 0) {
        await tx
          .update(receivedInvoicesTable)
          .set({ status: "answered", updatedAt: new Date() })
          .where(eq(receivedInvoicesTable.id, id));
      }
    });

    return res.json({
      ok: true,
      status: remaining === 0 ? "answered" : "sent",
      unassignedCount: remaining,
      unassignedAmount: unassignedAmount(items),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to respond received invoice");
    return res.status(500).json({ message: "送信に失敗しました。" });
  }
});

// ── POST /:id/reopen  事務が現場へ差し戻す（確認待ち → 未回答）──────────────────
//
// 現場から返ってきた書類は工事を選び直せないようにしてある（事務が見た内容と
// 確定される内容が食い違わないため）。工事が間違っていた場合の逃げ道がこれ。
// 回答済みの印を全員分消し、現場の「届いている書類」に戻す。
router.post("/:id/reopen", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    // 確認待ちだけでなく、途中まで返ってきている未回答も対象にする。
    // 先に返した人の分が固定されているため、それを直す手段がここしかない。
    if (inv.status !== "answered" && inv.status !== "sent") {
      return res.status(409).json({ message: "現場に出ている書類だけ差し戻せます。" });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(receivedInvoiceRecipientsTable)
        .set({ respondedAt: null })
        .where(eq(receivedInvoiceRecipientsTable.receivedInvoiceId, id));
      // 固定を解除して、現場が選び直せる状態に戻す（工事の選択自体は残す）。
      await tx
        .update(receivedInvoiceItemsTable)
        .set({ lockedAt: null, updatedAt: new Date() })
        .where(eq(receivedInvoiceItemsTable.receivedInvoiceId, id));
      await tx
        .update(receivedInvoicesTable)
        .set({ status: "sent", updatedAt: new Date() })
        .where(eq(receivedInvoicesTable.id, id));
    });

    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reopen received invoice");
    return res.status(500).json({ message: "差し戻しに失敗しました。" });
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

    const prevStatus = inv.status;
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

    // ── 二重確定の防止 ─────────────────────────────────────────────────────
    // 確定を同時に2本たたく／二度押しする／通信が遅くて再送される、のいずれでも
    // 仕入伝票が2組できて原価が二重に計上されていた（実際に再現）。
    // 先に「確定済み」を書き込めた1本だけが伝票の作成に進めるようにする。
    const claimed = await db
      .update(receivedInvoicesTable)
      .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(receivedInvoicesTable.id, id), ne(receivedInvoicesTable.status, "confirmed")))
      .returning({ id: receivedInvoicesTable.id });
    if (claimed.length === 0) {
      return res.status(409).json({ message: "すでに確定済みです。" });
    }

    const created: Array<{ projectId: number; voucherNumber: string; totalAmount: number }> = [];

    try {
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
    } catch (err) {
      // 伝票づくりの途中で落ちたら、確定の印を元に戻して再挑戦できるようにする。
      // ここで戻さないと「確定済みなのに伝票が無い」書類が残る。
      await db
        .update(receivedInvoicesTable)
        .set({ status: prevStatus, confirmedAt: null, updatedAt: new Date() })
        .where(eq(receivedInvoicesTable.id, id));
      throw err;
    }

    return res.json({ ok: true, created });
  } catch (err) {
    req.log.error({ err }, "Failed to confirm received invoice");
    return res.status(500).json({ message: "確定に失敗しました。" });
  }
});

// ── POST /:id/unconfirm  確定を取り消す（確定済 → 確認待ち）────────────────────
//
// 工事を間違えたまま確定すると、これまでは伝票を手で消して仕入入力で作り直すしか
// 手がなかった。ここで、生成した仕入伝票と原価をまとめて取り消し、書類を確認待ちに
// 戻す。戻したあとは差し戻して現場に選び直してもらう流れになる。
//
// 支払済・査定済の伝票が1枚でもあるときは取り消さない（支払・査定の整合を壊すため）。
router.post("/:id/unconfirm", async (req, res) => {
  try {
    const id = Number(req.params["id"]);
    const [inv] = await db.select().from(receivedInvoicesTable).where(eq(receivedInvoicesTable.id, id));
    if (!inv) return res.status(404).json({ message: "見つかりません" });
    if (inv.status !== "confirmed") {
      return res.status(409).json({ message: "確定済みの書類だけ取り消せます。" });
    }

    const vouchers = await db
      .select({ id: purchaseInvoicesTable.id, voucherNumber: purchaseInvoicesTable.voucherNumber, status: purchaseInvoicesTable.status })
      .from(purchaseInvoicesTable)
      .where(eq(purchaseInvoicesTable.receivedInvoiceId, id));

    const blocked = vouchers.filter((v) => v.status === "paid" || v.status === "assessed");
    if (blocked.length > 0) {
      return res.status(409).json({
        message: `支払済・査定済の仕入伝票があるため取り消せません（${blocked.map((v) => v.voucherNumber).join(", ")}）。先に支払・査定を取り消してください。`,
      });
    }

    await db.transaction(async (tx) => {
      for (const v of vouchers) {
        // 原価（cost_items）を先に消してから伝票を消す。順番を逆にすると原価が残る。
        await deleteCostItemsByInvoiceId(tx, v.id);
        await tx.delete(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.id, v.id));
      }
      // 誰が見ても分かるように、取り消した事実を備考へ残す。
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const note = `${stamp} 確定を取り消し（仕入伝票${vouchers.length}件を削除）`;
      await tx
        .update(receivedInvoicesTable)
        .set({
          status: "answered",
          confirmedAt: null,
          notes: inv.notes ? `${inv.notes}\n${note}` : note,
          updatedAt: new Date(),
        })
        .where(eq(receivedInvoicesTable.id, id));
    });

    return res.json({ ok: true, deleted: vouchers.map((v) => v.voucherNumber) });
  } catch (err) {
    req.log.error({ err }, "Failed to unconfirm received invoice");
    return res.status(500).json({ message: "確定の取り消しに失敗しました。" });
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
