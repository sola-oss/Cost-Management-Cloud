import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vendorsTable, vendorGroupsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select({
        vendor: vendorsTable,
        groupName: vendorGroupsTable.name,
      })
      .from(vendorsTable)
      .leftJoin(vendorGroupsTable, eq(vendorsTable.groupId, vendorGroupsTable.id))
      .orderBy(vendorsTable.name);

    res.json({
      items: rows.map((r) => ({ ...r.vendor, groupName: r.groupName ?? null })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list vendors");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      name, code, groupId, address, closingDay, paymentMonths, paymentDay, contactName, phone, email, notes,
      invoiceRegistrationNumber,
      bankCode, bankName, bankNameKana, bankBranchCode, bankBranch, bankBranchKana,
      bankAccountType, bankAccountNumber, bankAccountHolder, bankAccountHolderKana,
    } = req.body;
    if (!name) return res.status(400).json({ message: "name は必須です" });
    const [row] = await db
      .insert(vendorsTable)
      .values({
        name,
        code: code ?? null,
        groupId: groupId ? Number(groupId) : null,
        address: address ?? "",
        closingDay: closingDay != null ? Number(closingDay) : 99,
        paymentMonths: paymentMonths != null ? Number(paymentMonths) : 1,
        paymentDay: paymentDay != null ? Number(paymentDay) : 25,
        contactName: contactName ?? null,
        phone: phone ?? null,
        email: email ?? null,
        notes: notes ?? null,
        invoiceRegistrationNumber: invoiceRegistrationNumber ?? "",
        bankCode: bankCode ?? "",
        bankName: bankName ?? "",
        bankNameKana: bankNameKana ?? "",
        bankBranchCode: bankBranchCode ?? "",
        bankBranch: bankBranch ?? "",
        bankBranchKana: bankBranchKana ?? "",
        bankAccountType: bankAccountType ?? "普通",
        bankAccountNumber: bankAccountNumber ?? "",
        bankAccountHolder: bankAccountHolder ?? "",
        bankAccountHolderKana: bankAccountHolderKana ?? "",
      })
      .returning();
    return res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create vendor");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      name, code, groupId, address, closingDay, paymentMonths, paymentDay, contactName, phone, email, notes,
      invoiceRegistrationNumber,
      bankCode, bankName, bankNameKana, bankBranchCode, bankBranch, bankBranchKana,
      bankAccountType, bankAccountNumber, bankAccountHolder, bankAccountHolderKana,
    } = req.body;
    const [row] = await db
      .update(vendorsTable)
      .set({
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code: code ?? null }),
        ...(groupId !== undefined && { groupId: groupId ? Number(groupId) : null }),
        ...(address !== undefined && { address: address ?? "" }),
        ...(closingDay !== undefined && { closingDay: Number(closingDay) }),
        ...(paymentMonths !== undefined && { paymentMonths: Number(paymentMonths) }),
        ...(paymentDay !== undefined && { paymentDay: Number(paymentDay) }),
        ...(contactName !== undefined && { contactName: contactName ?? null }),
        ...(phone !== undefined && { phone: phone ?? null }),
        ...(email !== undefined && { email: email ?? null }),
        ...(notes !== undefined && { notes: notes ?? null }),
        ...(invoiceRegistrationNumber !== undefined && { invoiceRegistrationNumber: invoiceRegistrationNumber ?? "" }),
        ...(bankCode !== undefined && { bankCode: bankCode ?? "" }),
        ...(bankName !== undefined && { bankName: bankName ?? "" }),
        ...(bankNameKana !== undefined && { bankNameKana: bankNameKana ?? "" }),
        ...(bankBranchCode !== undefined && { bankBranchCode: bankBranchCode ?? "" }),
        ...(bankBranch !== undefined && { bankBranch: bankBranch ?? "" }),
        ...(bankBranchKana !== undefined && { bankBranchKana: bankBranchKana ?? "" }),
        ...(bankAccountType !== undefined && { bankAccountType: bankAccountType ?? "普通" }),
        ...(bankAccountNumber !== undefined && { bankAccountNumber: bankAccountNumber ?? "" }),
        ...(bankAccountHolder !== undefined && { bankAccountHolder: bankAccountHolder ?? "" }),
        ...(bankAccountHolderKana !== undefined && { bankAccountHolderKana: bankAccountHolderKana ?? "" }),
        updatedAt: new Date(),
      })
      .where(eq(vendorsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "仕入先が見つかりません" });
    return res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update vendor");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(vendorsTable).where(eq(vendorsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete vendor");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
