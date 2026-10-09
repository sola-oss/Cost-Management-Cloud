import { Router, type IRouter } from "express";
import { eq, sql, and, or, ilike, inArray, desc } from "drizzle-orm";
import { confirmedCostOnly, isConfirmedCost } from "../lib/cost-stage";
import { pendingProvisionalTotal } from "./cost-stage-links";
import { db, projectsTable, costItemsTable, budgetsTable, budgetItemsTable, invoicesTable, invoicePaymentsTable, companySettingsTable, constructionHistoriesTable, estimatesTable, purchaseOrdersTable, purchaseInvoicesTable, paymentsTable, isProjectDepartment } from "@workspace/db";
import { isUniqueViolation } from "../lib/db-errors";
import { uploadInvoiceFile, getSignedUrl, readLocalFile, storageMode, newStorageKey } from "../lib/invoice-storage";

const router: IRouter = Router();

function parseNumeric(val: unknown): number {
  return typeof val === "string" ? parseFloat(val) : (val as number) ?? 0;
}

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

/**
 * 工事番号を自動で振って、run(番号) を実行する。
 * 事務が手で採番した番号とぶつかることがあるため、一意制約に当たったら次の番号で数回やり直す。
 * 番号は「prefix + 連番(pad桁) + suffix」。連番は prefix で始まる既存番号の最大+1。
 * 振れなかったら null。
 */
async function withAutoProjectCode<T>(
  prefix: string, pad: number, suffix: string, run: (projectCode: string) => Promise<T>,
): Promise<T | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const [maxRow] = await db
      .select({ max: sql<string | null>`MAX(${projectsTable.projectCode})` })
      .from(projectsTable)
      .where(ilike(projectsTable.projectCode, `${prefix}%`));
    const currentSeq = maxRow?.max ? parseInt(maxRow.max.slice(prefix.length, prefix.length + pad)) || 0 : 0;
    const projectCode = `${prefix}${String(currentSeq + 1 + attempt).padStart(pad, "0")}${suffix}`;
    try {
      return await run(projectCode);
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  return null;
}

/** 正式な工事番号（YYYYMM####-00）。小口工事の登録と、仮登録からの本登録で使う */
function withRegularProjectCode<T>(run: (projectCode: string) => Promise<T>) {
  const today = new Date().toISOString().slice(0, 10);
  return withAutoProjectCode(today.slice(0, 4) + today.slice(5, 7), 4, "-00", run);
}

function buildProjectListItem(project: typeof projectsTable.$inferSelect, totalBudget: number, totalActualCost: number) {
  const contractAmount = parseNumeric(project.contractAmount);
  const isSmall = project.managementType === "small";
  // 粗利率は「予定」ベース：（請負金額 − 実行予算）÷ 請負金額。実行予算が未設定なら算定不可（null）
  // 小口工事は実行予算を作らないので、代わりに実績原価で見る（請負 − 実績原価）。
  const grossProfitRate = isSmall
    ? (contractAmount > 0 ? Math.round(((contractAmount - totalActualCost) / contractAmount) * 1000) / 10 : null)
    : (contractAmount > 0 && totalBudget > 0
        ? Math.round(((contractAmount - totalBudget) / contractAmount) * 1000) / 10
        : null);
  const budgetUsageRate = totalBudget > 0 ? (totalActualCost / totalBudget) * 100 : 0;

  return {
    id: project.id,
    projectCode: project.projectCode,
    name: project.name,
    clientName: project.clientName,
    contractAmount,
    status: project.status,
    managementType: project.managementType,
    siteManager: project.siteManager,
    startDate: project.startDate,
    endDate: project.endDate,
    totalBudget,
    totalActualCost,
    budgetUsageRate: Math.round(budgetUsageRate * 10) / 10,
    grossProfitRate,
  };
}

router.get("/", async (req, res) => {
  try {
    const { status, search, siteManager, managementType, page = "1", limit = "20" } = req.query as Record<string, string>;
    // 不正な値で .limit(NaN)/.offset(NaN) になり500化するのを防ぎ、上限もクランプする。
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit) || 20), 2000);
    const offset = (pageNum - 1) * limitNum;

    // 管理区分「以外」の絞り込み。タブの件数は区分を外した同じ条件で数える
    // （「通常(4) / 小口(12)」を出すため。検索やステータスの絞り込みには追従させる）
    const baseConditions = [];
    if (status) baseConditions.push(eq(projectsTable.status, status as any));
    // 工事担当で絞る（現場担当者が自分の担当工事だけを見るため）
    if (siteManager && siteManager.trim()) {
      baseConditions.push(eq(projectsTable.siteManager, siteManager.trim()));
    }
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      // 工事名・工事番号・得意先名で検索
      baseConditions.push(or(
        ilike(projectsTable.name, q),
        ilike(projectsTable.projectCode, q),
        ilike(projectsTable.clientName, q),
      ));
    }

    const isSmallOnly = managementType === "small";
    const conditions = [...baseConditions];
    // 管理区分で絞る（通常の工事一覧に小口が大量に混ざって埋もれるのを防ぐ）
    if (managementType === "normal" || managementType === "small") {
      conditions.push(eq(projectsTable.managementType, managementType));
    }
    const whereConditions = conditions.length > 0 ? and(...conditions) : undefined;
    const baseWhere = baseConditions.length > 0 ? and(...baseConditions) : undefined;

    const [projects, countResult, typeCounts] = await Promise.all([
      db.select().from(projectsTable)
        .where(whereConditions)
        .limit(limitNum)
        .offset(offset)
        // 小口は件数が増え続けるので新しい順。通常の工事はこれまで通り登録順
        .orderBy(isSmallOnly ? desc(projectsTable.createdAt) : projectsTable.createdAt),
      db.select({ count: sql<number>`count(*)` }).from(projectsTable).where(whereConditions),
      db.select({ managementType: projectsTable.managementType, count: sql<number>`count(*)` })
        .from(projectsTable).where(baseWhere).groupBy(projectsTable.managementType),
    ]);

    const counts = { normal: 0, small: 0 };
    for (const row of typeCounts) {
      if (row.managementType === "small") counts.small = Number(row.count);
      else counts.normal += Number(row.count);
    }

    const projectIds = projects.map(p => p.id);

    const [budgetTotals, costTotals] = await Promise.all([
      projectIds.length > 0
        ? db.select({
            projectId: budgetItemsTable.projectId,
            total: sql<string>`SUM(${budgetItemsTable.revisedBudget})`,
          }).from(budgetItemsTable).where(inArray(budgetItemsTable.projectId, projectIds))
          .groupBy(budgetItemsTable.projectId)
        : [],
      projectIds.length > 0
        ? db.select({
            projectId: costItemsTable.projectId,
            total: sql<string>`SUM(${costItemsTable.amount})`,
          }).from(costItemsTable).where(and(inArray(costItemsTable.projectId, projectIds), confirmedCostOnly))
          .groupBy(costItemsTable.projectId)
        : [],
    ]);

    const budgetMap = new Map(budgetTotals.map(b => [b.projectId, parseFloat(b.total ?? "0")]));
    const costMap = new Map(costTotals.map(c => [c.projectId, parseFloat(c.total ?? "0")]));

    const items = projects.map(p => buildProjectListItem(p, budgetMap.get(p.id) ?? 0, costMap.get(p.id) ?? 0));

    res.json({
      items,
      total: Number(countResult[0]?.count ?? 0),
      counts,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      projectCode, name, clientName, location, contractAmount, status = "planning", startDate, endDate, description,
      shortName, estimateNumber, orderType, orderDate, taxRate, taxExcludedAmount, taxAmount, taxIncludedAmount,
      overview, department, salesStaff, siteManager, category1, category2, category3,
      handoverDate, progressRate, recognitionBasis,
      projectCodeBranch, startDateActual, endDateActual, handoverDateActual,
      floorAreaTsubo, floorAreaSqm, memo, isCompleted, contractLines,
      publicPrivateType, clientCode, constructionHistoryType, constructionHistoryEngineer,
    } = req.body;

    if (!isProjectDepartment(department)) {
      res.status(400).json({ message: "部門（おおつか／冨士岡工務店）を選んでください" });
      return;
    }

    const [project] = await db.insert(projectsTable).values({
      projectCode, name, clientName, location,
      contractAmount: String(contractAmount),
      status,
      startDate, endDate,
      description: description ?? null,
      shortName: shortName ?? null,
      estimateNumber: estimateNumber ?? null,
      orderType: orderType ?? null,
      orderDate: toDateString(orderDate),
      taxRate: toNumericString(taxRate),
      taxExcludedAmount: toNumericString(taxExcludedAmount),
      taxAmount: toNumericString(taxAmount),
      taxIncludedAmount: toNumericString(taxIncludedAmount),
      overview: overview ?? null,
      department,
      salesStaff: salesStaff ?? null,
      siteManager: siteManager ?? null,
      category1: category1 ?? null,
      category2: category2 ?? null,
      category3: category3 ?? null,
      handoverDate: toDateString(handoverDate),
      progressRate: progressRate ?? null,
      recognitionBasis: recognitionBasis ?? null,
      projectCodeBranch: projectCodeBranch ?? null,
      startDateActual: toDateString(startDateActual),
      endDateActual: toDateString(endDateActual),
      handoverDateActual: toDateString(handoverDateActual),
      floorAreaTsubo: toNumericString(floorAreaTsubo),
      floorAreaSqm: toNumericString(floorAreaSqm),
      memo: memo ?? null,
      isCompleted: isCompleted ?? false,
      contractLines: contractLines ?? null,
      publicPrivateType: publicPrivateType ?? null,
      clientCode: clientCode ?? null,
      constructionHistoryType: constructionHistoryType ?? null,
      constructionHistoryEngineer: constructionHistoryEngineer ?? null,
    }).returning();

    res.status(201).json({
      ...project,
      contractAmount: parseNumeric(project.contractAmount),
      taxRate: project.taxRate != null ? parseNumeric(project.taxRate) : null,
      taxExcludedAmount: project.taxExcludedAmount != null ? parseNumeric(project.taxExcludedAmount) : null,
      taxAmount: project.taxAmount != null ? parseNumeric(project.taxAmount) : null,
      taxIncludedAmount: project.taxIncludedAmount != null ? parseNumeric(project.taxIncludedAmount) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("duplicate key") && msg.includes("project_code_unique")) {
      res.status(409).json({ message: "この工事番号はすでに使用されています。工事番号を変更してください。" });
      return;
    }
    res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * POST /api/projects/small — 小口工事（その他）の簡易登録
 *
 * 金額の小さい工事まで通常の登録画面（工事番号・場所・得意先・着工日・竣工予定日…）を
 * 埋めるのは手間に合わないため、**工事名・請負金額・担当者の3つだけ**で登録する。
 * 残りはここで既定値を入れる：工事番号は自動採番、日付は登録日、場所と得意先は空。
 * あとから通常の編集画面で足せる（区分を「通常」に変えれば普通の工事として扱える）。
 */
router.post("/small", async (req, res) => {
  try {
    const { name, contractAmount, siteManager, department } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "工事名は必須です" });
    }
    if (!isProjectDepartment(department)) {
      return res.status(400).json({ message: "部門（おおつか／冨士岡工務店）を選んでください" });
    }
    const amount = typeof contractAmount === "string" ? parseFloat(contractAmount) : Number(contractAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ message: "請負金額を正しく入力してください" });
    }

    const today = new Date().toISOString().slice(0, 10);
    const project = await withRegularProjectCode(async (projectCode) => {
      const [row] = await db.insert(projectsTable).values({
        projectCode,
        name: String(name).trim(),
        clientName: "",
        location: "",
        contractAmount: String(amount),
        status: "active",
        managementType: "small",
        department,
        startDate: today,
        endDate: today,
        siteManager: siteManager ? String(siteManager).trim() : null,
      }).returning();
      return row;
    });
    if (project) return res.status(201).json({ ...project, contractAmount: parseNumeric(project.contractAmount) });
    return res.status(409).json({ message: "工事番号の自動採番に失敗しました。時間をおいて再度お試しください。" });
  } catch (err) {
    req.log.error({ err }, "Failed to create small project");
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * POST /api/projects/provisional — 工事の仮登録
 *
 * 正式に工事を登録する前に書類が届くことがある（例：工事が決まる前に下請へ見積を頼み、
 * ③下請見積書をスキャンする）。その場で工事名だけで受け皿を作り、書類を紐づけられるようにする。
 * おおつか様の追加依頼2（2026-09-16）。
 *
 * 仮登録の工事は請負金額も部門も無いので、会社全体の合計・粗利には入れない
 * （status = "provisional" で集計から外す）。工事番号も正式な番号を消費しないよう「仮####」を振り、
 * 本登録のときに正式な番号へ付け替える。
 */
router.post("/provisional", async (req, res) => {
  try {
    const { name, siteManager } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "工事名は必須です" });
    }
    const today = new Date().toISOString().slice(0, 10);
    const project = await withAutoProjectCode("仮", 4, "", async (projectCode) => {
      const [row] = await db.insert(projectsTable).values({
        projectCode,
        name: String(name).trim(),
        clientName: "",
        location: "",
        contractAmount: "0",
        status: "provisional",
        managementType: "normal",
        startDate: today,
        endDate: today,
        siteManager: siteManager ? String(siteManager).trim() : null,
      }).returning();
      return row;
    });
    if (project) return res.status(201).json({ ...project, contractAmount: parseNumeric(project.contractAmount) });
    return res.status(409).json({ message: "工事番号の自動採番に失敗しました。時間をおいて再度お試しください。" });
  } catch (err) {
    req.log.error({ err }, "Failed to create provisional project");
    return res.status(500).json({ message: "Internal server error" });
  }
});

/**
 * POST /api/projects/from-order — ①元請注文書から工事を仮登録する
 *
 * 事務が注文書をスキャンし、読み取った工事名・請負金額・工期を確認して保存する。
 * 部門は現場担当者が決めるので（追加依頼4）、ここでは仮登録のまま止める。担当者が
 * 「自分の現場」または工事詳細の「本登録する」で部門を選ぶと正式な工事になる。
 *
 * targetProjectId を渡すと、先に作ってある仮登録の工事（③下請見積書などで作ったもの）に
 * 注文書の内容を入れる。作り直さないので、紐づけ済みの書類はそのまま残る。
 * 実行予算は作らない（温品様の回答 2026-10-02）。
 */
router.post("/from-order", async (req, res) => {
  try {
    const {
      targetProjectId, name, clientName, clientCode, location, orderDate, startDate, endDate,
      taxExcludedAmount, taxAmount, contractAmount, siteManager, orderNumber, fileBase64, mediaType,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "工事名は必須です" });
    }
    const amount = typeof contractAmount === "string" ? parseFloat(contractAmount) : Number(contractAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "請負金額（税込）を入力してください" });
    }
    if (!siteManager || !String(siteManager).trim()) {
      // 部門を決めるのは担当者。担当者が決まっていないと、誰の「自分の現場」にも出ず本登録されない
      return res.status(400).json({ message: "担当者を選んでください（担当者が部門を決めて本登録します）" });
    }

    let target: typeof projectsTable.$inferSelect | undefined;
    if (targetProjectId != null) {
      [target] = await db.select().from(projectsTable).where(eq(projectsTable.id, Number(targetProjectId)));
      if (!target) return res.status(404).json({ message: "工事が見つかりません" });
      if (target.status !== "provisional") {
        return res.status(400).json({ message: "この工事はすでに本登録されています" });
      }
    }

    // 原本を先に保存（DBに入れる前に。失敗したら中断）
    let orderFilePath: string | null = null;
    const media = mediaType ?? "application/pdf";
    if (fileBase64) {
      orderFilePath = newStorageKey(media, "prime-orders/");
      await uploadInvoiceFile(orderFilePath, fileBase64, media);
    }

    const today = new Date().toISOString().slice(0, 10);
    const start = toDateString(startDate) ?? today;
    const fields = {
      name: String(name).trim(),
      clientName: clientName ? String(clientName).trim() : "",
      clientCode: clientCode ? String(clientCode).trim() : null,
      location: location ? String(location).trim() : "",
      orderDate: toDateString(orderDate),
      startDate: start,
      endDate: toDateString(endDate) ?? start,
      contractAmount: String(amount),
      taxRate: "10",
      taxExcludedAmount: toNumericString(taxExcludedAmount),
      taxAmount: toNumericString(taxAmount),
      taxIncludedAmount: String(amount),
      siteManager: String(siteManager).trim(),
      // 注文番号の専用欄は無いのでメモに残す（元請との照合に使う）
      ...(orderNumber && String(orderNumber).trim()
        ? { memo: [target?.memo, `注文番号: ${String(orderNumber).trim()}`].filter(Boolean).join("\n") }
        : {}),
      ...(orderFilePath ? { orderFilePath, orderMediaType: media } : {}),
      updatedAt: new Date(),
    };

    if (target) {
      const [updated] = await db.update(projectsTable).set(fields)
        .where(and(eq(projectsTable.id, target.id), eq(projectsTable.status, "provisional"))).returning();
      if (!updated) return res.status(409).json({ message: "この工事はすでに本登録されています" });
      return res.json({ ...updated, contractAmount: parseNumeric(updated.contractAmount) });
    }

    const project = await withAutoProjectCode("仮", 4, "", async (projectCode) => {
      const [row] = await db.insert(projectsTable).values({
        ...fields,
        projectCode,
        status: "provisional",
        managementType: "normal",
      }).returning();
      return row;
    });
    if (project) return res.status(201).json({ ...project, contractAmount: parseNumeric(project.contractAmount) });
    return res.status(409).json({ message: "工事番号の自動採番に失敗しました。時間をおいて再度お試しください。" });
  } catch (err) {
    req.log.error({ err }, "Failed to create project from prime order");
    return res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/projects/:id/order-file — ①元請注文書の原本（本番=署名URLへリダイレクト / ローカル=そのまま配信）
router.get("/:id/order-file", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [p] = await db
      .select({ filePath: projectsTable.orderFilePath, mediaType: projectsTable.orderMediaType })
      .from(projectsTable)
      .where(eq(projectsTable.id, id));
    if (!p?.filePath) return res.status(404).json({ message: "注文書の原本がありません" });
    if (storageMode === "supabase") {
      const url = await getSignedUrl(p.filePath);
      if (!url) return res.status(502).json({ message: "URLの発行に失敗しました" });
      return res.redirect(url);
    }
    const buf = await readLocalFile(p.filePath);
    if (!buf) return res.status(404).json({ message: "ファイルが見つかりません" });
    res.setHeader("Content-Type", p.mediaType ?? "application/octet-stream");
    return res.end(buf);
  } catch (err) {
    req.log.error({ err }, "Failed to serve order file");
    return res.status(500).json({ message: "ファイルの取得に失敗しました。" });
  }
});

/**
 * POST /api/projects/:id/promote — 仮登録の工事を本登録にする
 *
 * 部門を決めることが本登録の条件（部門は現場担当者が決める。追加依頼4）。
 * 同じ工事を作り直さずに格上げするので、仮登録中に紐づけた書類・原価はそのまま残る。
 * 工事番号は正式な番号（YYYYMM####-00）に付け替える。
 */
router.post("/:id/promote", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { department, managementType = "normal", contractAmount, startDate, endDate } = req.body;

    const [current] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!current) return res.status(404).json({ message: "工事が見つかりません" });
    if (current.status !== "provisional") {
      return res.status(400).json({ message: "この工事はすでに本登録されています" });
    }
    if (!isProjectDepartment(department)) {
      return res.status(400).json({ message: "部門（おおつか／冨士岡工務店）を選んでください" });
    }
    if (managementType !== "normal" && managementType !== "small") {
      return res.status(400).json({ message: "区分が正しくありません" });
    }
    const amount = typeof contractAmount === "string" ? parseFloat(contractAmount) : Number(contractAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ message: "請負金額を正しく入力してください" });
    }
    const today = new Date().toISOString().slice(0, 10);
    const start = toDateString(startDate) ?? today;
    const end = toDateString(endDate) ?? start;

    // 二度押しなどで先に本登録されていたら、更新0件で null を返す（番号の振り直しはしない）
    let alreadyPromoted = false;
    const project = await withRegularProjectCode(async (projectCode) => {
      const [row] = await db.update(projectsTable).set({
        projectCode,
        department,
        managementType,
        contractAmount: String(amount),
        // 小口は登録した時点で「施工中」（小口の新規登録と同じ）
        status: managementType === "small" ? "active" : "planning",
        startDate: start,
        endDate: end,
        updatedAt: new Date(),
      }).where(and(eq(projectsTable.id, id), eq(projectsTable.status, "provisional"))).returning();
      if (!row) alreadyPromoted = true;
      return row ?? null;
    });
    if (alreadyPromoted) return res.status(409).json({ message: "この工事はすでに本登録されています" });
    if (project) return res.json({ ...project, contractAmount: parseNumeric(project.contractAmount) });
    return res.status(409).json({ message: "工事番号の自動採番に失敗しました。時間をおいて再度お試しください。" });
  } catch (err) {
    req.log.error({ err }, "Failed to promote project");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    const [costItems, budgets, budgetItemRows] = await Promise.all([
      db.select().from(costItemsTable).where(eq(costItemsTable.projectId, id)).orderBy(costItemsTable.incurredDate),
      db.select().from(budgetsTable).where(eq(budgetsTable.projectId, id)),
      db.select({ total: sql<string>`COALESCE(SUM(${budgetItemsTable.revisedBudget}),0)` })
        .from(budgetItemsTable).where(eq(budgetItemsTable.projectId, id)),
    ]);

    // 実行予算（budget_items）の合計を予算とする（旧budgetsは下の区分別表示でのみ使用）
    const totalBudget = parseNumeric(budgetItemRows[0]?.total ?? "0");
    // 明細は全段階を返すが、合計に入れるのは確定原価だけ
    const confirmedItems = costItems.filter(isConfirmedCost);
    const totalActualCost = confirmedItems.reduce((sum, c) => sum + parseNumeric(c.amount), 0);
    const contractAmount = parseNumeric(project.contractAmount);
    const grossProfit = contractAmount - totalActualCost;
    const grossProfitRate = contractAmount > 0 ? (grossProfit / contractAmount) * 100 : 0;

    const budgetActualMap = new Map<string, number>();
    for (const ci of confirmedItems) {
      budgetActualMap.set(ci.category, (budgetActualMap.get(ci.category) ?? 0) + parseNumeric(ci.amount));
    }

    const budgetsWithActual = budgets.map(b => {
      const actualAmount = budgetActualMap.get(b.category) ?? 0;
      const budgetAmount = parseNumeric(b.budgetAmount);
      const variance = budgetAmount - actualAmount;
      const usageRate = budgetAmount > 0 ? (actualAmount / budgetAmount) * 100 : 0;
      return {
        ...b,
        budgetAmount,
        actualAmount,
        variance,
        usageRate: Math.round(usageRate * 10) / 10,
      };
    });

    return res.json({
      ...project,
      contractAmount,
      taxRate: project.taxRate != null ? parseNumeric(project.taxRate) : null,
      taxExcludedAmount: project.taxExcludedAmount != null ? parseNumeric(project.taxExcludedAmount) : null,
      taxAmount: project.taxAmount != null ? parseNumeric(project.taxAmount) : null,
      taxIncludedAmount: project.taxIncludedAmount != null ? parseNumeric(project.taxIncludedAmount) : null,
      totalBudget,
      totalActualCost,
      grossProfit,
      grossProfitRate: Math.round(grossProfitRate * 10) / 10,
      costItems: costItems.map(ci => ({
        ...ci,
        amount: parseNumeric(ci.amount),
        quantity: ci.quantity ? parseNumeric(ci.quantity) : null,
        unitPrice: ci.unitPrice ? parseNumeric(ci.unitPrice) : null,
      })),
      budgets: budgetsWithActual,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      projectCode, name, clientName, location, contractAmount, status, managementType, startDate, endDate, completedDate, description,
      shortName, estimateNumber, orderType, orderDate, taxRate, taxExcludedAmount, taxAmount, taxIncludedAmount,
      overview, department, salesStaff, siteManager, category1, category2, category3,
      handoverDate, progressRate, recognitionBasis,
      projectCodeBranch, startDateActual, endDateActual, handoverDateActual,
      floorAreaTsubo, floorAreaSqm, memo, isCompleted, contractLines,
      publicPrivateType, clientCode, constructionHistoryType, constructionHistoryEngineer,
    } = req.body;

    const updateData: Partial<typeof projectsTable.$inferInsert> = {};
    if (projectCode !== undefined) updateData.projectCode = projectCode;
    if (managementType === "normal" || managementType === "small") updateData.managementType = managementType;
    if (name !== undefined) updateData.name = name;
    if (clientName !== undefined) updateData.clientName = clientName;
    if (location !== undefined) updateData.location = location;
    if (contractAmount !== undefined) updateData.contractAmount = String(contractAmount);
    if (status !== undefined) {
      // 仮登録との行き来は本登録（/promote）だけ。編集で外すと部門なしの工事が集計に入ってしまう
      const [cur] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, id));
      if (!cur) return res.status(404).json({ message: "工事が見つかりません" });
      if ((cur.status === "provisional") !== (status === "provisional")) {
        return res.status(400).json({ message: "仮登録の工事は「本登録する」から登録してください" });
      }
      updateData.status = status;
    }
    if (startDate !== undefined) updateData.startDate = startDate;
    if (endDate !== undefined) updateData.endDate = endDate;
    if (completedDate !== undefined) updateData.completedDate = completedDate;
    if (description !== undefined) updateData.description = description;
    if (shortName !== undefined) updateData.shortName = shortName;
    if (estimateNumber !== undefined) updateData.estimateNumber = estimateNumber;
    if (orderType !== undefined) updateData.orderType = orderType;
    if (orderDate !== undefined) updateData.orderDate = toDateString(orderDate);
    if (taxRate !== undefined) updateData.taxRate = toNumericString(taxRate);
    if (taxExcludedAmount !== undefined) updateData.taxExcludedAmount = toNumericString(taxExcludedAmount);
    if (taxAmount !== undefined) updateData.taxAmount = toNumericString(taxAmount);
    if (taxIncludedAmount !== undefined) updateData.taxIncludedAmount = toNumericString(taxIncludedAmount);
    if (overview !== undefined) updateData.overview = overview || null;
    // 部門は一度決めたら変えさせない（MFの仕訳と食い違うため）。未設定の工事だけ、ここで決められる
    if (department !== undefined) {
      const [current] = await db.select({ department: projectsTable.department, status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, id));
      if (!current) return res.status(404).json({ message: "工事が見つかりません" });
      const next = department || null;
      if (current.status === "provisional") {
        // 仮登録の部門は本登録（/promote）で決める。ここで入れると本登録の条件が崩れる
        if (next !== null) return res.status(400).json({ message: "仮登録の工事は「本登録する」から部門を選んでください" });
      } else if (current.department) {
        if (next !== current.department) {
          return res.status(400).json({ message: "部門は登録後に変更できません" });
        }
      } else if (next !== null) {
        if (!isProjectDepartment(next)) {
          return res.status(400).json({ message: "部門（おおつか／冨士岡工務店）を選んでください" });
        }
        updateData.department = next;
      }
    }
    if (salesStaff !== undefined) updateData.salesStaff = salesStaff || null;
    if (siteManager !== undefined) updateData.siteManager = siteManager || null;
    if (category1 !== undefined) updateData.category1 = category1 || null;
    if (category2 !== undefined) updateData.category2 = category2 || null;
    if (category3 !== undefined) updateData.category3 = category3 || null;
    if (handoverDate !== undefined) updateData.handoverDate = toDateString(handoverDate);
    if (progressRate !== undefined) updateData.progressRate = progressRate;
    if (recognitionBasis !== undefined) updateData.recognitionBasis = recognitionBasis;
    if (projectCodeBranch !== undefined) updateData.projectCodeBranch = projectCodeBranch || null;
    if (startDateActual !== undefined) updateData.startDateActual = toDateString(startDateActual);
    if (endDateActual !== undefined) updateData.endDateActual = toDateString(endDateActual);
    if (handoverDateActual !== undefined) updateData.handoverDateActual = toDateString(handoverDateActual);
    if (floorAreaTsubo !== undefined) updateData.floorAreaTsubo = toNumericString(floorAreaTsubo);
    if (floorAreaSqm !== undefined) updateData.floorAreaSqm = toNumericString(floorAreaSqm);
    if (memo !== undefined) updateData.memo = memo || null;
    if (isCompleted !== undefined) updateData.isCompleted = isCompleted;
    if (contractLines !== undefined) updateData.contractLines = contractLines;
    if (publicPrivateType !== undefined) updateData.publicPrivateType = publicPrivateType || null;
    if (clientCode !== undefined) updateData.clientCode = clientCode || null;
    if (constructionHistoryType !== undefined) updateData.constructionHistoryType = constructionHistoryType || null;
    if (constructionHistoryEngineer !== undefined) updateData.constructionHistoryEngineer = constructionHistoryEngineer || null;
    updateData.updatedAt = new Date();

    const [updated] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "工事が見つかりません" });

    return res.json({
      ...updated,
      contractAmount: parseNumeric(updated.contractAmount),
      taxRate: updated.taxRate != null ? parseNumeric(updated.taxRate) : null,
      taxExcludedAmount: updated.taxExcludedAmount != null ? parseNumeric(updated.taxExcludedAmount) : null,
      taxAmount: updated.taxAmount != null ? parseNumeric(updated.taxAmount) : null,
      taxIncludedAmount: updated.taxIncludedAmount != null ? parseNumeric(updated.taxIncludedAmount) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ message: "Invalid project ID" });

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    // 関連データがある工事は、cascadeで発注・仕入・請求・予算・原価・支払が
    // 巻き込み削除されてしまうため、安全のため削除を禁止する。
    // （工事履歴だけは付随メタデータなので判定に含めない＝空の工事は削除可能）
    const cnt = sql<number>`count(*)::int`;
    const [estRows, budRows, budItemRows, costRows, poRows, pinvRows, invRows, payRows] =
      await Promise.all([
        db.select({ n: cnt }).from(estimatesTable).where(eq(estimatesTable.projectId, id)),
        db.select({ n: cnt }).from(budgetsTable).where(eq(budgetsTable.projectId, id)),
        db.select({ n: cnt }).from(budgetItemsTable).where(eq(budgetItemsTable.projectId, id)),
        db.select({ n: cnt }).from(costItemsTable).where(eq(costItemsTable.projectId, id)),
        db.select({ n: cnt }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.projectId, id)),
        db.select({ n: cnt }).from(purchaseInvoicesTable).where(eq(purchaseInvoicesTable.projectId, id)),
        db.select({ n: cnt }).from(invoicesTable).where(eq(invoicesTable.projectId, id)),
        db.select({ n: cnt }).from(paymentsTable).where(eq(paymentsTable.projectId, id)),
      ]);
    const estimates = estRows[0]?.n ?? 0;
    const budgets = budRows[0]?.n ?? 0;
    const budgetItems = budItemRows[0]?.n ?? 0;
    const costItems = costRows[0]?.n ?? 0;
    const purchaseOrders = poRows[0]?.n ?? 0;
    const purchaseInvoices = pinvRows[0]?.n ?? 0;
    const invoices = invRows[0]?.n ?? 0;
    const payments = payRows[0]?.n ?? 0;

    const related = {
      estimates,
      budgets: budgets + budgetItems,
      costItems,
      purchaseOrders,
      purchaseInvoices,
      invoices,
      payments,
    };
    const total = Object.values(related).reduce((s, v) => s + v, 0);
    if (total > 0) {
      return res.status(409).json({
        message: "関連データがあるため、この工事は削除できません。先に関連する見積・発注・仕入・請求・支払・実行予算を削除してください。",
        related,
      });
    }

    await db.delete(projectsTable).where(eq(projectsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/summary", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    const [costItems, budgetItemRows] = await Promise.all([
      db.select().from(costItemsTable).where(eq(costItemsTable.projectId, id)),
      db.select({ total: sql<string>`COALESCE(SUM(${budgetItemsTable.revisedBudget}),0)` })
        .from(budgetItemsTable).where(eq(budgetItemsTable.projectId, id)),
    ]);

    const costByCategory = { material: 0, labor: 0, subcontract: 0, expense: 0 };
    for (const ci of costItems.filter(isConfirmedCost)) {
      costByCategory[ci.category as keyof typeof costByCategory] += parseNumeric(ci.amount);
    }

    // 実行予算（budget_items）の合計を予算とする
    const totalBudget = parseNumeric(budgetItemRows[0]?.total ?? "0");
    const totalActualCost = Object.values(costByCategory).reduce((s, v) => s + v, 0);
    const contractAmount = parseNumeric(project.contractAmount);
    // 実績粗利：請負 − 実績原価（進捗にあわせた実態）
    const grossProfit = contractAmount - totalActualCost;
    const grossProfitRate = contractAmount > 0 ? (grossProfit / contractAmount) * 100 : 0;
    // 予定粗利：請負 − 実行予算（計画段階の採算）。実行予算未設定なら算定不可（null）
    const plannedGrossProfit = contractAmount - totalBudget;
    const plannedGrossProfitRate = (contractAmount > 0 && totalBudget > 0)
      ? Math.round((plannedGrossProfit / contractAmount) * 1000) / 10
      : null;
    const budgetUsageRate = totalBudget > 0 ? (totalActualCost / totalBudget) * 100 : 0;
    // 仮原価（納品書だけ届いている分）。原価には入れないが、見えないと不安なので別に返す。
    // 請求書と紐づけ済みのものは「待ち」から外す（もう請求書が来ているため）。
    const provisionalCost = await pendingProvisionalTotal(id);

    return res.json({
      projectId: id,
      contractAmount,
      totalBudget,
      totalActualCost,
      provisionalCost,
      grossProfit,
      grossProfitRate: Math.round(grossProfitRate * 10) / 10,
      plannedGrossProfit,
      plannedGrossProfitRate,
      budgetUsageRate: Math.round(budgetUsageRate * 10) / 10,
      costBreakdown: costByCategory,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project summary");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id/ledger", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ message: "Invalid project ID" });

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return res.status(404).json({ message: "工事が見つかりません" });

    const [costItems, budgets, constructionHistory, invoiceRows, companyRows] = await Promise.all([
      db.select().from(costItemsTable).where(eq(costItemsTable.projectId, id)),
      db.select().from(budgetsTable).where(eq(budgetsTable.projectId, id)),
      db.select().from(constructionHistoriesTable).where(eq(constructionHistoriesTable.projectId, id)).then(r => r[0] ?? null),
      db.select().from(invoicesTable).where(eq(invoicesTable.projectId, id)).orderBy(invoicesTable.invoiceDate),
      db.select().from(companySettingsTable).limit(1),
    ]);

    const totalBudget = budgets.reduce((s, b) => s + parseNumeric(b.budgetAmount), 0);
    const confirmedItems = costItems.filter(isConfirmedCost);
    const totalActualCost = confirmedItems.reduce((s, c) => s + parseNumeric(c.amount), 0);
    // 完成工事原価の内訳（材料費・労務費・外注費・経費）
    const costByCategory = { material: 0, labor: 0, subcontract: 0, expense: 0 };
    for (const c of confirmedItems) {
      const cat = c.category as keyof typeof costByCategory;
      if (cat in costByCategory) costByCategory[cat] += parseNumeric(c.amount);
    }
    const contractAmount = parseNumeric(project.contractAmount);
    const grossProfit = contractAmount - totalActualCost;
    const grossProfitRate = contractAmount > 0 ? (grossProfit / contractAmount) * 100 : 0;

    // 請求ごとに入金を個別取得するとN+1になるため、全請求の入金を1クエリでまとめて取得し
    // メモリ上で請求IDごとに振り分ける（結果は従来と同じ。paymentDate順も維持）。
    const invoiceIds = invoiceRows.map((inv) => inv.id);
    const allInvPayments = invoiceIds.length > 0
      ? await db.select().from(invoicePaymentsTable).where(inArray(invoicePaymentsTable.invoiceId, invoiceIds)).orderBy(invoicePaymentsTable.paymentDate)
      : [];
    const payByInvoice = new Map<number, typeof allInvPayments>();
    for (const p of allInvPayments) {
      const arr = payByInvoice.get(p.invoiceId) ?? [];
      arr.push(p);
      payByInvoice.set(p.invoiceId, arr);
    }

    const invoicesWithPayments = invoiceRows.map((inv) => ({
      ...inv,
      totalAmount: parseNumeric(inv.totalAmount),
      paidAmount: parseNumeric(inv.paidAmount),
      payments: (payByInvoice.get(inv.id) ?? []).map((p) => ({ ...p, amount: parseNumeric(p.amount) })),
    }));

    const totalInvoiced = invoicesWithPayments.reduce((s, inv) => s + inv.totalAmount, 0);
    const totalPaid = invoicesWithPayments.reduce((s, inv) => s + inv.paidAmount, 0);
    const totalUnpaid = totalInvoiced - totalPaid;

    return res.json({
      project: {
        ...project,
        contractAmount,
        taxExcludedAmount: project.taxExcludedAmount != null ? parseNumeric(project.taxExcludedAmount) : null,
        taxAmount: project.taxAmount != null ? parseNumeric(project.taxAmount) : null,
        taxIncludedAmount: project.taxIncludedAmount != null ? parseNumeric(project.taxIncludedAmount) : null,
        floorAreaTsubo: project.floorAreaTsubo != null ? parseNumeric(project.floorAreaTsubo) : null,
        floorAreaSqm: project.floorAreaSqm != null ? parseNumeric(project.floorAreaSqm) : null,
      },
      constructionHistory,
      invoices: invoicesWithPayments,
      companySettings: companyRows[0] ?? null,
      summary: {
        totalBudget,
        totalActualCost,
        costByCategory,
        grossProfit,
        grossProfitRate: Math.round(grossProfitRate * 10) / 10,
        totalInvoiced,
        totalPaid,
        totalUnpaid,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project ledger");
    return res.status(500).json({ message: "Internal server error" });
  }
});


export default router;
