import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  projectProgressRecordsTable,
  projectsTable,
  budgetItemsTable,
  costItemsTable,
} from "@workspace/db";

// mergeParams: 親ルート /projects/:id の :id を受け取るため
const router: IRouter = Router({ mergeParams: true });

function parseNum(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) || 0 : ((v as number) ?? 0);
}

function thisYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-06" の1つ前 "2026-05" */
function prevYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isValidYearMonth(ym: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

// ── GET /api/projects/:id/progress ────────────────────────────────────────────
// 履歴＋入力の判断材料（先月の進捗率・原価消化率・実行予算残）を返す。
// 「なんとなく65%」を防ぐため、入力画面の横に出す数字をここで揃える。
router.get("/", async (req, res) => {
  try {
    const projectId = Number((req.params as Record<string, string>)["id"]);
    if (!Number.isInteger(projectId)) return res.status(400).json({ message: "不正なIDです" });

    const [[project], records, [budgetRow], [costRow]] = await Promise.all([
      db.select().from(projectsTable).where(eq(projectsTable.id, projectId)),
      db
        .select()
        .from(projectProgressRecordsTable)
        .where(eq(projectProgressRecordsTable.projectId, projectId))
        .orderBy(desc(projectProgressRecordsTable.yearMonth)),
      db
        .select({ total: sql<string>`COALESCE(SUM(${budgetItemsTable.revisedBudget}),0)` })
        .from(budgetItemsTable)
        .where(eq(budgetItemsTable.projectId, projectId)),
      db
        .select({ total: sql<string>`COALESCE(SUM(${costItemsTable.amount}),0)` })
        .from(costItemsTable)
        .where(eq(costItemsTable.projectId, projectId)),
    ]);

    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    const totalBudget = parseNum(budgetRow?.total ?? "0");
    const totalActualCost = parseNum(costRow?.total ?? "0");
    const ym = thisYearMonth();
    const prev = prevYearMonth(ym);

    const current = records.find((r) => r.yearMonth === ym) ?? null;
    const previous = records.find((r) => r.yearMonth === prev) ?? null;
    // 先月が無ければ、当月より前で一番新しいものを「前回」として扱う
    const lastBefore = previous ?? records.find((r) => r.yearMonth < ym) ?? null;

    return res.json({
      projectId,
      yearMonth: ym,
      // 入力の判断材料
      currentRate: current?.progressRate ?? null,
      previousRate: lastBefore?.progressRate ?? null,
      previousYearMonth: lastBefore?.yearMonth ?? null,
      totalBudget,
      totalActualCost,
      budgetRemaining: totalBudget - totalActualCost,
      // 原価消化率。これを横に出さないと進捗率の入力が当てずっぽうになる
      costConsumptionRate: totalBudget > 0 ? Math.round((totalActualCost / totalBudget) * 1000) / 10 : null,
      records: records.map((r) => ({
        yearMonth: r.yearMonth,
        progressRate: r.progressRate,
        note: r.note,
        recordedBy: r.recordedBy,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project progress");
    return res.status(500).json({ message: "進捗率の取得に失敗しました。" });
  }
});

// ── PUT /api/projects/:id/progress ────────────────────────────────────────────
// 当月（または指定月）の進捗率を登録・更新する。
// body: { yearMonth?, progressRate, note?, recordedBy?, allowDecrease? }
router.put("/", async (req, res) => {
  try {
    const projectId = Number((req.params as Record<string, string>)["id"]);
    if (!Number.isInteger(projectId)) return res.status(400).json({ message: "不正なIDです" });

    const b = req.body as {
      yearMonth?: string;
      progressRate?: number;
      note?: string | null;
      recordedBy?: string | null;
      allowDecrease?: boolean;
    };
    const ym = b.yearMonth ?? thisYearMonth();
    if (!isValidYearMonth(ym)) return res.status(400).json({ message: "年月は YYYY-MM 形式で指定してください" });

    const rate = Number(b.progressRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return res.status(400).json({ message: "進捗率は0〜100で指定してください" });
    }

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    // 前月より下げようとしていないか（単調増加のガード）。
    // 下げる場合は理由(note)を付けて allowDecrease で明示的に許可する。
    const past = await db
      .select()
      .from(projectProgressRecordsTable)
      .where(and(
        eq(projectProgressRecordsTable.projectId, projectId),
        sql`${projectProgressRecordsTable.yearMonth} < ${ym}`,
      ))
      .orderBy(desc(projectProgressRecordsTable.yearMonth))
      .limit(1);

    const prevRate = past[0]?.progressRate ?? null;
    if (prevRate != null && rate < prevRate && !b.allowDecrease) {
      return res.status(409).json({
        message: `前回（${past[0].yearMonth}）の ${prevRate}% より低い値です。下げる場合は理由を入力してください。`,
        previousRate: prevRate,
        previousYearMonth: past[0].yearMonth,
        requiresReason: true,
      });
    }
    if (prevRate != null && rate < prevRate && !(b.note ?? "").trim()) {
      return res.status(400).json({ message: "進捗率を下げるときは理由を入力してください。", requiresReason: true });
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(projectProgressRecordsTable)
        .values({
          projectId,
          yearMonth: ym,
          progressRate: Math.round(rate),
          note: b.note ?? null,
          recordedBy: b.recordedBy ?? null,
        })
        .onConflictDoUpdate({
          target: [projectProgressRecordsTable.projectId, projectProgressRecordsTable.yearMonth],
          set: {
            progressRate: Math.round(rate),
            note: b.note ?? null,
            recordedBy: b.recordedBy ?? null,
            updatedAt: new Date(),
          },
        });

      // 最新月の入力なら projects.progress_rate（実行予算画面・工事台帳が見る現在値）も更新する
      const [latest] = await tx
        .select({ ym: projectProgressRecordsTable.yearMonth, rate: projectProgressRecordsTable.progressRate })
        .from(projectProgressRecordsTable)
        .where(eq(projectProgressRecordsTable.projectId, projectId))
        .orderBy(desc(projectProgressRecordsTable.yearMonth))
        .limit(1);
      if (latest) {
        await tx
          .update(projectsTable)
          .set({ progressRate: latest.rate, updatedAt: new Date() })
          .where(eq(projectsTable.id, projectId));
      }
    });

    return res.json({ ok: true, yearMonth: ym, progressRate: Math.round(rate) });
  } catch (err) {
    req.log.error({ err }, "Failed to save project progress");
    return res.status(500).json({ message: "進捗率の保存に失敗しました。" });
  }
});

export default router;

// ── 一覧用：複数工事の当月進捗をまとめて返すヘルパー ───────────────────────────
// 「自分の現場」画面で、工事ごとに1リクエストずつ投げないためのもの。
export async function fetchProgressSummary(projectIds: number[]) {
  if (projectIds.length === 0) return new Map<number, { currentRate: number | null; previousRate: number | null }>();
  const ym = thisYearMonth();
  const rows = await db
    .select()
    .from(projectProgressRecordsTable)
    .where(inArray(projectProgressRecordsTable.projectId, projectIds))
    .orderBy(desc(projectProgressRecordsTable.yearMonth));

  const map = new Map<number, { currentRate: number | null; previousRate: number | null }>();
  for (const pid of projectIds) {
    const mine = rows.filter((r) => r.projectId === pid);
    map.set(pid, {
      currentRate: mine.find((r) => r.yearMonth === ym)?.progressRate ?? null,
      previousRate: mine.find((r) => r.yearMonth < ym)?.progressRate ?? null,
    });
  }
  return map;
}
