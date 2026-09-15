import { Router, type IRouter } from "express";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db, attendancesTable, staffMembersTable } from "@workspace/db";

// ─── 出面（でづら）────────────────────────────────────────────────────────────
//
// 工事 × 月で「誰が何日入ったか」を読み書きする。
// 金額は出さない（職人単価をシステムに持てるか未確定のため。温品様へ確認中）。

const router: IRouter = Router();

const parseN = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0);

/** "2026-09" → その月の初日と末日 */
function monthRange(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    from: `${m[1]}-${m[2]}-01`,
    to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`,
    days: last,
  };
}

/**
 * GET /api/attendances?projectId=1&month=2026-09
 * その工事・その月の出面と、選べる社員の一覧を返す。
 */
router.get("/", async (req, res) => {
  try {
    const projectId = parseInt(String(req.query["projectId"] ?? ""));
    const month = String(req.query["month"] ?? "");
    if (!Number.isInteger(projectId)) return res.status(400).json({ message: "projectId は必須です" });
    const range = monthRange(month);
    if (!range) return res.status(400).json({ message: "month は YYYY-MM で指定してください" });

    const [rows, staff] = await Promise.all([
      db
        .select()
        .from(attendancesTable)
        .where(and(
          eq(attendancesTable.projectId, projectId),
          gte(attendancesTable.workDate, range.from),
          lte(attendancesTable.workDate, range.to),
        ))
        .orderBy(asc(attendancesTable.workDate)),
      db
        .select({ id: staffMembersTable.id, code: staffMembersTable.code, name: staffMembersTable.name })
        .from(staffMembersTable)
        .where(eq(staffMembersTable.isActive, true))
        .orderBy(asc(staffMembersTable.code)),
    ]);

    return res.json({
      month,
      days: range.days,
      staff,
      items: rows.map((r) => ({
        staffMemberId: r.staffMemberId,
        workDate: r.workDate,
        manDays: parseN(r.manDays),
        earlyCount: parseN(r.earlyCount),
        overtimeCount: parseN(r.overtimeCount),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list attendances");
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * PUT /api/attendances
 * body: { projectId, items: [{ staffMemberId, workDate, manDays, earlyCount, overtimeCount }] }
 *
 * 送られた1マスぶんを入れ替える。3つとも0なら行ごと消す（0だらけの行を残さない）。
 */
router.put("/", async (req, res) => {
  try {
    const b = req.body as {
      projectId?: number;
      items?: Array<{
        staffMemberId: number;
        workDate: string;
        manDays?: number;
        earlyCount?: number;
        overtimeCount?: number;
      }>;
    };
    const projectId = Number(b.projectId);
    if (!Number.isInteger(projectId)) return res.status(400).json({ message: "projectId は必須です" });
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length === 0) return res.json({ ok: true, saved: 0 });

    await db.transaction(async (tx) => {
      for (const it of items) {
        const manDays = Number(it.manDays ?? 0);
        const earlyCount = Number(it.earlyCount ?? 0);
        const overtimeCount = Number(it.overtimeCount ?? 0);
        const where = and(
          eq(attendancesTable.projectId, projectId),
          eq(attendancesTable.staffMemberId, Number(it.staffMemberId)),
          eq(attendancesTable.workDate, it.workDate),
        );
        if (manDays === 0 && earlyCount === 0 && overtimeCount === 0) {
          await tx.delete(attendancesTable).where(where);
          continue;
        }
        await tx
          .insert(attendancesTable)
          .values({
            projectId,
            staffMemberId: Number(it.staffMemberId),
            workDate: it.workDate,
            manDays: String(manDays),
            earlyCount: String(earlyCount),
            overtimeCount: String(overtimeCount),
          })
          .onConflictDoUpdate({
            target: [attendancesTable.projectId, attendancesTable.staffMemberId, attendancesTable.workDate],
            set: {
              manDays: String(manDays),
              earlyCount: String(earlyCount),
              overtimeCount: String(overtimeCount),
              updatedAt: new Date(),
            },
          });
      }
    });

    return res.json({ ok: true, saved: items.length });
  } catch (err) {
    req.log.error({ err }, "Failed to save attendances");
    return res.status(500).json({ message: "保存に失敗しました。" });
  }
});

/**
 * GET /api/attendances/summary?projectId=1
 * その工事の合計（社員ごとの人工・早出・残業と、工事全体の合計）。月をまたいで数える。
 */
router.get("/summary", async (req, res) => {
  try {
    const projectId = parseInt(String(req.query["projectId"] ?? ""));
    if (!Number.isInteger(projectId)) return res.status(400).json({ message: "projectId は必須です" });

    const rows = await db
      .select({
        staffMemberId: attendancesTable.staffMemberId,
        name: staffMembersTable.name,
        manDays: sql<string>`SUM(${attendancesTable.manDays})`,
        earlyCount: sql<string>`SUM(${attendancesTable.earlyCount})`,
        overtimeCount: sql<string>`SUM(${attendancesTable.overtimeCount})`,
      })
      .from(attendancesTable)
      .leftJoin(staffMembersTable, eq(attendancesTable.staffMemberId, staffMembersTable.id))
      .where(eq(attendancesTable.projectId, projectId))
      .groupBy(attendancesTable.staffMemberId, staffMembersTable.name);

    const items = rows.map((r) => ({
      staffMemberId: r.staffMemberId,
      name: r.name ?? "",
      manDays: parseN(r.manDays),
      earlyCount: parseN(r.earlyCount),
      overtimeCount: parseN(r.overtimeCount),
    }));

    return res.json({
      items: items.sort((a, b) => b.manDays - a.manDays),
      total: {
        manDays: items.reduce((s, i) => s + i.manDays, 0),
        earlyCount: items.reduce((s, i) => s + i.earlyCount, 0),
        overtimeCount: items.reduce((s, i) => s + i.overtimeCount, 0),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to summarize attendances");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
