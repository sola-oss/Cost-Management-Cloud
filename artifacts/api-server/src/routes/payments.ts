import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, gte, lte, isNotNull } from "drizzle-orm";
import iconv from "iconv-lite";
import { db, paymentsTable, projectsTable, companySettingsTable, vendorsTable, purchaseInvoicesTable } from "@workspace/db";

const router: IRouter = Router();

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : ((val as number) ?? 0);
}

function formatPayment(p: typeof paymentsTable.$inferSelect) {
  return {
    ...p,
    amount: parseNumeric(p.amount),
    paidAmount: p.paidAmount != null ? parseNumeric(p.paidAmount) : null,
  };
}

// ─── 全銀フォーマット ヘルパー ────────────────────────────────────────────────

const KATA_MAP: Record<number, string> = {
  0x30A1: "ｧ", 0x30A2: "ｱ", 0x30A3: "ｨ", 0x30A4: "ｲ", 0x30A5: "ｩ",
  0x30A6: "ｳ", 0x30A7: "ｪ", 0x30A8: "ｴ", 0x30A9: "ｫ", 0x30AA: "ｵ",
  0x30AB: "ｶ", 0x30AC: "ｶﾞ", 0x30AD: "ｷ", 0x30AE: "ｷﾞ", 0x30AF: "ｸ",
  0x30B0: "ｸﾞ", 0x30B1: "ｹ", 0x30B2: "ｹﾞ", 0x30B3: "ｺ", 0x30B4: "ｺﾞ",
  0x30B5: "ｻ", 0x30B6: "ｻﾞ", 0x30B7: "ｼ", 0x30B8: "ｼﾞ", 0x30B9: "ｽ",
  0x30BA: "ｽﾞ", 0x30BB: "ｾ", 0x30BC: "ｾﾞ", 0x30BD: "ｿ", 0x30BE: "ｿﾞ",
  0x30BF: "ﾀ", 0x30C0: "ﾀﾞ", 0x30C1: "ﾁ", 0x30C2: "ﾁﾞ", 0x30C3: "ｯ",
  0x30C4: "ﾂ", 0x30C5: "ﾂﾞ", 0x30C6: "ﾃ", 0x30C7: "ﾃﾞ", 0x30C8: "ﾄ",
  0x30C9: "ﾄﾞ", 0x30CA: "ﾅ", 0x30CB: "ﾆ", 0x30CC: "ﾇ", 0x30CD: "ﾈ",
  0x30CE: "ﾉ", 0x30CF: "ﾊ", 0x30D0: "ﾊﾞ", 0x30D1: "ﾊﾟ", 0x30D2: "ﾋ",
  0x30D3: "ﾋﾞ", 0x30D4: "ﾋﾟ", 0x30D5: "ﾌ", 0x30D6: "ﾌﾞ", 0x30D7: "ﾌﾟ",
  0x30D8: "ﾍ", 0x30D9: "ﾍﾞ", 0x30DA: "ﾍﾟ", 0x30DB: "ﾎ", 0x30DC: "ﾎﾞ",
  0x30DD: "ﾎﾟ", 0x30DE: "ﾏ", 0x30DF: "ﾐ", 0x30E0: "ﾑ", 0x30E1: "ﾒ",
  0x30E2: "ﾓ", 0x30E3: "ｬ", 0x30E4: "ﾔ", 0x30E5: "ｭ", 0x30E6: "ﾕ",
  0x30E7: "ｮ", 0x30E8: "ﾖ", 0x30E9: "ﾗ", 0x30EA: "ﾘ", 0x30EB: "ﾙ",
  0x30EC: "ﾚ", 0x30ED: "ﾛ", 0x30EE: "ﾜ", 0x30EF: "ﾜ", 0x30F0: "ｲ",
  0x30F1: "ｴ", 0x30F2: "ｦ", 0x30F3: "ﾝ", 0x30F4: "ｳﾞ", 0x30F5: "ｶ",
  0x30F6: "ｹ", 0x30FB: "･", 0x30FC: "ｰ",
};

function toHalfWidth(str: string): string {
  if (!str) return "";
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    if (cp >= 0xFF01 && cp <= 0xFF5E) {
      result += String.fromCharCode(cp - 0xFEE0);
    } else if (cp === 0x3000) {
      result += " ";
    } else if (cp >= 0x3041 && cp <= 0x3096) {
      const kata = cp + 0x60;
      result += KATA_MAP[kata] ?? String.fromCharCode(cp);
    } else if (cp >= 0x30A1 && cp <= 0x30FC) {
      result += KATA_MAP[cp] ?? String.fromCharCode(cp);
    } else {
      result += str[i];
    }
  }
  return result;
}

function padN(val: string | number, len: number): string {
  const s = String(val).replace(/\D/g, "").padStart(len, "0");
  return s.slice(-len);
}

function padC(val: string, len: number): string {
  const s = toHalfWidth(val ?? "");
  return s.slice(0, len).padEnd(len, " ");
}

function accountTypeCode(type: string | null | undefined, fallback = "9"): string {
  if (type === "普通") return "1";
  if (type === "当座") return "2";
  if (type === "貯蓄") return "4";
  if (type === "その他") return "9";
  return fallback;
}

// ─── GET /api/payments ────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const { projectId, status } = req.query as Record<string, string>;

    const conditions = [];
    if (projectId) conditions.push(eq(paymentsTable.projectId, parseInt(projectId)));
    if (status) conditions.push(eq(paymentsTable.status, status as any));

    const rows = await db
      .select({
        payment: paymentsTable,
        projectCode: projectsTable.projectCode,
        projectName: projectsTable.name,
      })
      .from(paymentsTable)
      .innerJoin(projectsTable, eq(paymentsTable.projectId, projectsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(paymentsTable.createdAt))
      .limit(200);

    const totalAmount = rows.reduce((s, r) => s + parseNumeric(r.payment.amount), 0);
    const paidAmount = rows
      .filter((r) => r.payment.status === "paid")
      .reduce((s, r) => s + parseNumeric(r.payment.amount), 0);

    res.json({
      items: rows.map((r) => ({
        ...formatPayment(r.payment),
        projectCode: r.projectCode,
        projectName: r.projectName,
      })),
      total: rows.length,
      totalAmount,
      paidAmount,
      pendingAmount: totalAmount - paidAmount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list payments");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/payments ───────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  try {
    const { projectId, vendor, description, amount, dueDate, invoiceNumber, notes } = req.body;

    if (!projectId || !vendor || !description || amount == null) {
      return res.status(400).json({ message: "projectId, vendor, description, amount は必須です" });
    }

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        projectId,
        vendor,
        description,
        amount: String(amount),
        paidAmount: null,
        dueDate: dueDate ?? null,
        paidDate: null,
        status: "pending",
        invoiceNumber: invoiceNumber ?? null,
        notes: notes ?? null,
      })
      .returning();

    return res.status(201).json(formatPayment(payment));
  } catch (err) {
    req.log.error({ err }, "Failed to create payment");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/payments/zengin ────────────────────────────────────────────────

router.post("/zengin", async (req, res) => {
  try {
    const { paymentIds, executionDate } = req.body as {
      paymentIds: number[];
      executionDate: string;
    };

    if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
      return res.status(400).json({ message: "paymentIds が空です" });
    }
    if (!executionDate || !/^\d{4}-\d{2}-\d{2}$/.test(executionDate)) {
      return res.status(400).json({ message: "executionDate が不正です (YYYY-MM-DD)" });
    }

    // 会社設定取得
    const settingsRows = await db.select().from(companySettingsTable).limit(1);
    const s = settingsRows[0];
    const missing: string[] = [];
    if (!s?.consignorCode) missing.push("委託者コード");
    if (!s?.companyNameKana) missing.push("会社名カナ");
    if (!s?.bankCode) missing.push("銀行コード");
    if (!s?.bankBranchCode) missing.push("支店コード");
    if (!s?.bankAccountType) missing.push("口座種別");
    if (!s?.bankAccountNumber) missing.push("口座番号");
    if (missing.length > 0) {
      return res.status(400).json({
        message: `会社設定の振込元情報が未入力です。未入力項目：${missing.join("、")}`,
      });
    }

    // 支払データ取得
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(inArray(paymentsTable.id, paymentIds));
    if (payments.length === 0) {
      return res.status(400).json({ message: "対象の支払データが見つかりません" });
    }

    // 仕入先マスタ（名前引き）
    const vendors = await db.select().from(vendorsTable);
    const vendorMap = new Map(vendors.map((v) => [v.name, v]));

    // 振込先（仕入先）の口座情報チェック。1社でも欠けていれば中止（無効な振込ファイルの生成を防ぐ）
    const invalidVendors: string[] = [];
    const seenVendor = new Set<string>();
    for (const payment of payments) {
      if (seenVendor.has(payment.vendor)) continue;
      seenVendor.add(payment.vendor);
      const v = vendorMap.get(payment.vendor);
      const lacks =
        !v ||
        !v.bankCode ||
        !v.bankBranchCode ||
        !v.bankAccountType ||
        !v.bankAccountNumber ||
        !v.bankAccountHolderKana;
      if (lacks) invalidVendors.push(payment.vendor);
    }
    if (invalidVendors.length > 0) {
      return res.status(400).json({
        message: `振込先の口座情報が未登録の仕入先があります：${invalidVendors.join("、")}。仕入先マスタで口座情報（銀行・支店・種別・口座番号・名義カナ）を登録してください。`,
      });
    }

    // 取組日 MMDD
    const [, mm, dd] = executionDate.split("-");
    const mmdd = `${mm}${dd}`;

    // ヘッダレコード（120バイト）
    // 1+2+1+10+40+4+4+15+3+15+1+7+17 = 120
    const header =
      "1" +
      "21" +
      "0" +
      padN(s.consignorCode!, 10) +
      padC(s.companyNameKana!, 40) +
      mmdd +
      padN(s.bankCode!, 4) +
      padC(s.bankNameKana ?? "", 15) +
      padN(s.bankBranchCode!, 3) +
      padC(s.bankBranchKana ?? "", 15) +
      accountTypeCode(s.bankAccountType) +
      padN(s.bankAccountNumber!, 7) +
      " ".repeat(17);

    // データレコード
    // 1+4+15+3+15+4+1+7+30+10+1+10+10+1+1+7 = 120
    const dataRecords: string[] = [];
    let totalAmount = 0;

    for (const payment of payments) {
      const vendor = vendorMap.get(payment.vendor);
      const amt = parseNumeric(payment.amount) - (payment.paidAmount ? parseNumeric(payment.paidAmount) : 0);
      const amtInt = Math.max(0, Math.round(amt));
      totalAmount += amtInt;

      const dataRecord =
        "2" +
        padN(vendor?.bankCode ?? "", 4) +
        padC(vendor?.bankNameKana ?? "", 15) +
        padN(vendor?.bankBranchCode ?? "", 3) +
        padC(vendor?.bankBranchKana ?? "", 15) +
        "0000" +
        accountTypeCode(vendor?.bankAccountType, "0") +
        padN(vendor?.bankAccountNumber ?? "", 7) +
        padC(vendor?.bankAccountHolderKana ?? "", 30) +
        padN(String(amtInt), 10) +
        "0" +
        " ".repeat(10) +
        " ".repeat(10) +
        "7" +
        " " +
        " ".repeat(7);

      dataRecords.push(dataRecord);
    }

    // トレーラレコード（120バイト）
    // 1+6+12+101 = 120
    const trailer =
      "8" +
      padN(dataRecords.length, 6) +
      padN(totalAmount, 12) +
      " ".repeat(101);

    // エンドレコード（120バイト）
    // 1+119 = 120
    const end = "9" + " ".repeat(119);

    const text = [header, ...dataRecords, trailer, end].join("\r\n") + "\r\n";

    const buffer = iconv.encode(text, "Shift_JIS");

    const now = new Date();
    const ts =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "_" +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");
    const filename = `furikomi_${ts}.txt`;

    res.setHeader("Content-Type", "text/plain; charset=Shift_JIS");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    req.log.error({ err }, "Failed to generate zengin file");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── PATCH /api/payments/:id/pay ──────────────────────────────────────────────

router.patch("/:id/pay", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { paidDate, paidAmount } = req.body;

    const existing = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
    if (!existing[0]) return res.status(404).json({ message: "支払が見つかりません" });

    const totalAmount = parseNumeric(existing[0].amount);
    const paid = paidAmount != null ? Number(paidAmount) : totalAmount;
    const newStatus = paid >= totalAmount ? "paid" : "partial";

    const [updated] = await db
      .update(paymentsTable)
      .set({
        paidDate: paidDate ?? new Date().toISOString().split("T")[0],
        paidAmount: String(paid),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(paymentsTable.id, id))
      .returning();

    return res.json(formatPayment(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to mark payment as paid");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── PATCH /api/payments/:id/unpay ───────────────────────────────────────────

router.patch("/:id/unpay", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const [updated] = await db
      .update(paymentsTable)
      .set({ paidDate: null, paidAmount: null, status: "pending", updatedAt: new Date() })
      .where(eq(paymentsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ message: "支払が見つかりません" });
    return res.json(formatPayment(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to revert payment");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ─── DELETE /api/payments/:id ────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // 査定由来の支払を削除する場合、対象の仕入伝票の「査定済み」印を戻す（再査定できるように）
    const [pay] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
    if (pay && pay.source === "assessment" && pay.invoiceNumber?.startsWith("key:")) {
      // invoiceNumber 形式: key:{start}_{end}_{group}_{type}_{closing}:{projectId}[:{workType}]
      const parts = pay.invoiceNumber.split(":");
      const keyParts = (parts[1] ?? "").split("_");
      const start = keyParts[0];
      const end = keyParts[1];
      const projectId = parseInt(parts[2] ?? "");
      const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
      if (isIsoDate(start) && isIsoDate(end) && Number.isInteger(projectId)) {
        // 支払の仕入先名 → vendorId（同名が複数あれば全て対象）
        const vendorRows = await db
          .select({ id: vendorsTable.id })
          .from(vendorsTable)
          .where(eq(vendorsTable.name, pay.vendor));
        const vendorIds = vendorRows.map((v) => v.id);
        if (vendorIds.length > 0) {
          await db
            .update(purchaseInvoicesTable)
            .set({ assessedAt: null, updatedAt: new Date() })
            .where(
              and(
                eq(purchaseInvoicesTable.projectId, projectId),
                inArray(purchaseInvoicesTable.vendorId, vendorIds),
                gte(purchaseInvoicesTable.purchaseDate, start),
                lte(purchaseInvoicesTable.purchaseDate, end),
                isNotNull(purchaseInvoicesTable.assessedAt)
              )
            );
        }
      }
    }

    await db.delete(paymentsTable).where(eq(paymentsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete payment");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
