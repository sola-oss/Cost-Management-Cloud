import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, companySettingsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await db.select().from(companySettingsTable).limit(1);
    if (rows.length === 0) {
      return res.json({
        id: null,
        companyName: "",
        postalCode: "",
        address: "",
        tel: "",
        fax: "",
        invoiceRegistrationNumber: "",
        representativeName: "",
        department: "",
        bankName: "",
        bankBranch: "",
        bankAccountType: "普通",
        bankAccountNumber: "",
        bankAccountName: "",
        constructionLicense: "",
        staffName: "",
        staffMobile: "",
        staffEmail: "",
        consignorCode: "",
        companyNameKana: "",
        bankCode: "",
        bankNameKana: "",
        bankBranchCode: "",
        bankBranchKana: "",
      });
    }
    return res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to get company settings");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/", async (req, res) => {
  try {
    const {
      companyName, postalCode, address, tel, fax,
      invoiceRegistrationNumber, representativeName, department,
      bankName, bankBranch, bankAccountType, bankAccountNumber, bankAccountName,
      constructionLicense, staffName, staffMobile, staffEmail,
      consignorCode, companyNameKana, bankCode, bankNameKana, bankBranchCode, bankBranchKana,
    } = req.body;

    const values = {
      companyName: companyName ?? "",
      postalCode: postalCode ?? "",
      address: address ?? "",
      tel: tel ?? "",
      fax: fax ?? "",
      invoiceRegistrationNumber: invoiceRegistrationNumber ?? "",
      representativeName: representativeName ?? "",
      department: department ?? "",
      bankName: bankName ?? "",
      bankBranch: bankBranch ?? "",
      bankAccountType: bankAccountType ?? "普通",
      bankAccountNumber: bankAccountNumber ?? "",
      bankAccountName: bankAccountName ?? "",
      constructionLicense: constructionLicense ?? "",
      staffName: staffName ?? "",
      staffMobile: staffMobile ?? "",
      staffEmail: staffEmail ?? "",
      consignorCode: consignorCode ?? "",
      companyNameKana: companyNameKana ?? "",
      bankCode: bankCode ?? "",
      bankNameKana: bankNameKana ?? "",
      bankBranchCode: bankBranchCode ?? "",
      bankBranchKana: bankBranchKana ?? "",
    };

    const rows = await db.select({ id: companySettingsTable.id }).from(companySettingsTable).limit(1);

    if (rows.length === 0) {
      const [row] = await db.insert(companySettingsTable).values(values).returning();
      return res.json(row);
    }

    const existingId = rows[0].id;
    const [row] = await db
      .update(companySettingsTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(companySettingsTable.id, existingId))
      .returning();

    return res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update company settings");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
