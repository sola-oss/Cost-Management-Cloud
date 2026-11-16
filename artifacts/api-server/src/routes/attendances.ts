import { Router, type IRouter } from "express";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, attendancesTable, craftsmenTable, projectCraftsmenTable } from "@workspace/db";

// ─── 出面（でづら）────────────────────────────────────────────────────────────
//
// 工事 × 月で「誰が何日入ったか」を読み書きする。人は職人マスタ（2026-11-16 担当者マスタから切り替え）。
// 表に並ぶのは「この現場の職人」として選んだ人（＋選んでいなくても、この工事に出面が入っている人）。
// 金額（人工×単価）は工事原価計算書（基本情報タブ）で出す。

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
 * この現場の表に並べる職人。選んだ順に、選んでいないが出面のある人を後ろに足す
 * （外しても入っている出面が見えなくならないように）。工事原価計算書の労務費でも使う。
 */
export async function crewOf(projectId: number) {
  const [picked, withData] = await Promise.all([
    db
      .select({ id: craftsmenTable.id, code: craftsmenTable.code, name: craftsmenTable.name, sortOrder: projectCraftsmenTable.sortOrder })
      .from(projectCraftsmenTable)
      .innerJoin(craftsmenTable, eq(projectCraftsmenTable.craftsmanId, craftsmenTable.id))
      .where(eq(projectCraftsmenTable.projectId, projectId))
      .orderBy(asc(projectCraftsmenTable.sortOrder), asc(craftsmenTable.code)),
    db
      .selectDistinct({ id: craftsmenTable.id, code: craftsmenTable.code, name: craftsmenTable.name })
      .from(attendancesTable)
      .innerJoin(craftsmenTable, eq(attendancesTable.craftsmanId, craftsmenTable.id))
      .where(eq(attendancesTable.projectId, projectId)),
  ]);
  const ids = new Set(picked.map((p) => p.id));
  return [
    ...picked.map(({ id, code, name }) => ({ id, code, name, picked: true })),
    ...withData.filter((w) => !ids.has(w.id)).sort((a, b) => a.code.localeCompare(b.code)).map((w) => ({ ...w, picked: false })),
  ];
}

/**
 * GET /api/attendances?projectId=1&month=2026-09
 * その工事・その月の出面と、表に並べる職人（staff）、選べる職人の一覧（craftsmen）を返す。
 */
router.get("/", async (req, res) => {
  try {
    const projectId = parseInt(String(req.query["projectId"] ?? ""));
    const month = String(req.query["month"] ?? "");
    if (!Number.isInteger(projectId)) return res.status(400).json({ message: "projectId は必須です" });
    const range = monthRange(month);
    if (!range) return res.status(400).json({ message: "month は YYYY-MM で指定してください" });

    const [rows, staff, craftsmen] = await Promise.all([
      db
        .select()
        .from(attendancesTable)
        .where(and(
          eq(attendancesTable.projectId, projectId),
          gte(attendancesTable.workDate, range.from),
          lte(attendancesTable.workDate, range.to),
        ))
        .orderBy(asc(attendancesTable.workDate)),
      crewOf(projectId),
      db
        .select({ id: craftsmenTable.id, code: craftsmenTable.code, name: craftsmenTable.name })
        .from(craftsmenTable)
        .where(eq(craftsmenTable.isActive, true))
        .orderBy(asc(craftsmenTable.code)),
    ]);

    return res.json({
      month,
      days: range.days,
      staff,
      craftsmen,
      items: rows.map((r) => ({
        craftsmanId: r.craftsmanId,
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
 * body: { projectId, items: [{ craftsmanId, workDate, manDays, earlyCount, overtimeCount }] }
 *
 * 送られた1マスぶんを入れ替える。3つとも0なら行ごと消す（0だらけの行を残さない）。
 */
router.put("/", async (req, res) => {
  try {
    const b = req.body as {
      projectId?: number;
      items?: Array<{
        craftsmanId: number;
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
          eq(attendancesTable.craftsmanId, Number(it.craftsmanId)),
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
            craftsmanId: Number(it.craftsmanId),
            workDate: it.workDate,
            manDays: String(manDays),
            earlyCount: String(earlyCount),
            overtimeCount: String(overtimeCount),
          })
          .onConflictDoUpdate({
            target: [attendancesTable.projectId, attendancesTable.craftsmanId, attendancesTable.workDate],
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
 * PUT /api/attendances/crew   body: { projectId, craftsmanIds: number[] }
 * この現場に入る職人を選ぶ（並び順もこの順）。送られなかった人は外す。外しても出面は消えない。
 */
router.put("/crew", async (req, res) => {
  try {
    const projectId = Number(req.body?.projectId);
    const ids: number[] = Array.isArray(req.body?.craftsmanIds) ? req.body.craftsmanIds.map(Number).filter(Number.isInteger) : [];
    if (!Number.isInteger(projectId)) return res.status(400).json({ message: "projectId は必須です" });
    const unique = [...new Set(ids)];
    if (unique.length > 0) {
      const found = await db.select({ id: craftsmenTable.id }).from(craftsmenTable).where(inArray(craftsmenTable.id, unique));
      if (found.length !== unique.length) return res.status(400).json({ message: "職人が見つかりません。画面を開き直してください。" });
    }
    await db.transaction(async (tx) => {
      await tx.delete(projectCraftsmenTable).where(eq(projectCraftsmenTable.projectId, projectId));
      if (unique.length > 0) {
        await tx.insert(projectCraftsmenTable).values(unique.map((craftsmanId, i) => ({ projectId, craftsmanId, sortOrder: i })));
      }
    });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save crew");
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
        craftsmanId: attendancesTable.craftsmanId,
        name: craftsmenTable.name,
        manDays: sql<string>`SUM(${attendancesTable.manDays})`,
        earlyCount: sql<string>`SUM(${attendancesTable.earlyCount})`,
        overtimeCount: sql<string>`SUM(${attendancesTable.overtimeCount})`,
      })
      .from(attendancesTable)
      .leftJoin(craftsmenTable, eq(attendancesTable.craftsmanId, craftsmenTable.id))
      .where(eq(attendancesTable.projectId, projectId))
      .groupBy(attendancesTable.craftsmanId, craftsmenTable.name);

    const items = rows.map((r) => ({
      craftsmanId: r.craftsmanId,
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
