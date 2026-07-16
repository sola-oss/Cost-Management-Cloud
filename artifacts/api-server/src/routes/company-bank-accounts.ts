import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, companyBankAccountsTable } from "@workspace/db";

const router: IRouter = Router();

const ACCOUNT_TYPES = ["普通", "当座", "貯蓄"] as const;

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(companyBankAccountsTable)
      .orderBy(asc(companyBankAccountsTable.displayOrder), asc(companyBankAccountsTable.id));
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list company bank accounts");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { bankName, bankBranch, accountType, accountNumber, accountHolder, displayOrder } = req.body;
    if (!clean(bankName) || !clean(accountNumber)) {
      return res.status(400).json({ message: "銀行名と口座番号は必須です" });
    }
    if (accountType && !ACCOUNT_TYPES.includes(clean(accountType) as typeof ACCOUNT_TYPES[number])) {
      return res.status(400).json({ message: "口座種別は 普通 / 当座 / 貯蓄 のいずれかです" });
    }
    const [row] = await db
      .insert(companyBankAccountsTable)
      .values({
        bankName: clean(bankName),
        bankBranch: clean(bankBranch),
        accountType: clean(accountType) || "普通",
        accountNumber: clean(accountNumber),
        accountHolder: clean(accountHolder),
        displayOrder: Number.isFinite(Number(displayOrder)) ? Number(displayOrder) : 0,
      })
      .returning();
    return res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create company bank account");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { bankName, bankBranch, accountType, accountNumber, accountHolder, displayOrder } = req.body;
    if (!clean(bankName) || !clean(accountNumber)) {
      return res.status(400).json({ message: "銀行名と口座番号は必須です" });
    }
    if (accountType && !ACCOUNT_TYPES.includes(clean(accountType) as typeof ACCOUNT_TYPES[number])) {
      return res.status(400).json({ message: "口座種別は 普通 / 当座 / 貯蓄 のいずれかです" });
    }
    const [row] = await db
      .update(companyBankAccountsTable)
      .set({
        bankName: clean(bankName),
        bankBranch: clean(bankBranch),
        accountType: clean(accountType) || "普通",
        accountNumber: clean(accountNumber),
        accountHolder: clean(accountHolder),
        ...(Number.isFinite(Number(displayOrder)) ? { displayOrder: Number(displayOrder) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(companyBankAccountsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "振込先口座が見つかりません" });
    return res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update company bank account");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(companyBankAccountsTable).where(eq(companyBankAccountsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete company bank account");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
