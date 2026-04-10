import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, constructionHistoriesTable } from "@workspace/db";

const router: IRouter = Router({ mergeParams: true });

function toNumericString(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "string" ? parseFloat(val) : Number(val);
  return isNaN(n) ? null : String(n);
}

function toDateString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

router.get("/", async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const [record] = await db
      .select()
      .from(constructionHistoriesTable)
      .where(eq(constructionHistoriesTable.projectId, projectId));

    if (!record) {
      return res.status(404).json({ message: "工事経歴書が見つかりません" });
    }

    res.json({
      ...record,
      contractAmount: record.contractAmount != null ? parseFloat(record.contractAmount) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get construction history");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const {
      constructionName, location, clientName, contractAmount, startDate, endDate,
      constructionType, contractType, primeContractorName,
      engineer1Category, engineer1Name, engineer1Qualification, engineer1LicenseNumber,
      specialist1WorkContent, specialist1Name, specialist1Qualification,
      remarks,
    } = req.body;

    const values = {
      projectId,
      constructionName: constructionName ?? null,
      location: location ?? null,
      clientName: clientName ?? null,
      contractAmount: toNumericString(contractAmount),
      startDate: toDateString(startDate),
      endDate: toDateString(endDate),
      constructionType: constructionType ?? null,
      contractType: contractType ?? null,
      primeContractorName: primeContractorName ?? null,
      engineer1Category: engineer1Category ?? null,
      engineer1Name: engineer1Name ?? null,
      engineer1Qualification: engineer1Qualification ?? null,
      engineer1LicenseNumber: engineer1LicenseNumber ?? null,
      specialist1WorkContent: specialist1WorkContent ?? null,
      specialist1Name: specialist1Name ?? null,
      specialist1Qualification: specialist1Qualification ?? null,
      remarks: remarks ?? null,
    };

    const [existing] = await db
      .select({ id: constructionHistoriesTable.id })
      .from(constructionHistoriesTable)
      .where(eq(constructionHistoriesTable.projectId, projectId));

    let record;
    if (existing) {
      [record] = await db
        .update(constructionHistoriesTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(constructionHistoriesTable.projectId, projectId))
        .returning();
    } else {
      [record] = await db
        .insert(constructionHistoriesTable)
        .values(values)
        .returning();
    }

    res.status(200).json({
      ...record,
      contractAmount: record.contractAmount != null ? parseFloat(record.contractAmount) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to upsert construction history");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
