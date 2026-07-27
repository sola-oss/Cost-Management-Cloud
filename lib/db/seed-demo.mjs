/**
 * 商談・実演用のデモデータ投入スクリプト。
 *
 *   DATABASE_URL=postgres://... node lib/db/seed-demo.mjs
 *
 * 架空の建設会社「株式会社みらい建設」の半年分を作る。登場する会社名・人名・
 * 工事名はすべて架空で、実在の顧客データは一切含めない。
 *
 * 【安全装置】
 * 実顧客のデータベースへ誤って流し込むと復旧できないため、次に当てはまるDBでは
 * 実行を拒否する:
 *   - 仕入先が30件を超える（実マスタが入っている疑い）
 *   - デモ以外の工事が存在する
 * 承知のうえで実行する場合のみ DEMO_SEED_CONFIRM=yes を付ける。
 *
 * 冪等：再実行するとデモの工事を消して作り直す。
 */
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const force = process.env.DEMO_SEED_CONFIRM === "yes";

// scrypt ハッシュ（artifacts/api-server/src/lib/auth.ts と同じ形式）
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

// ─── 架空の会社 ──────────────────────────────────────────────────────────────

const COMPANY = {
  company_name: "株式会社みらい建設",
  postal_code: "730-0013",
  address: "広島県広島市中区八丁堀12-5 みらいビル3F",
  tel: "082-000-0000",
  fax: "082-000-0001",
  representative_name: "渡辺 誠",
  construction_license: "広島県知事許可（般-6）第00000号",
  invoice_registration_number: "T0000000000000",
  bank_name: "ひろしま中央銀行",
  bank_branch: "八丁堀支店",
  bank_account_type: "普通",
  bank_account_number: "1234567",
  bank_account_name: "カ）ミライケンセツ",
};

const STAFF = [
  { code: "S01", name: "田中 一郎" },
  { code: "S02", name: "佐藤 健太" },
  { code: "S03", name: "高橋 直樹" },
  { code: "S04", name: "鈴木 美咲" },
  { code: "S05", name: "渡辺 誠" },
];

const VENDORS = [
  { code: "V001", name: "大和建材株式会社",     closing: 20, months: 1, payday: 25 },
  { code: "V002", name: "みなと鋼材株式会社",   closing: 99, months: 1, payday: 31 },
  { code: "V003", name: "さくら電設有限会社",   closing: 20, months: 1, payday: 25 },
  { code: "V004", name: "青葉塗装工業株式会社", closing: 99, months: 2, payday: 10 },
  { code: "V005", name: "東洋設備工業株式会社", closing: 20, months: 1, payday: 25 },
  { code: "V006", name: "北浜生コン株式会社",   closing: 99, months: 1, payday: 25 },
  { code: "V007", name: "ひかり足場工業",       closing: 20, months: 1, payday: 25 },
  { code: "V008", name: "中央木材株式会社",     closing: 99, months: 1, payday: 25 },
  { code: "V009", name: "明和空調サービス",     closing: 20, months: 1, payday: 25 },
  { code: "V010", name: "富士造園土木株式会社", closing: 99, months: 2, payday: 10 },
];

// ─── 工事 ────────────────────────────────────────────────────────────────────
//
// ダッシュボードで「4通りの状態」が一目で並ぶよう意図的に散らしてある：
//   A-101 順調（原価が出来高を下回る）
//   A-102 危険（原価が出来高より15pt先行し、粗利がほぼ消える見込み）
//   A-103 出来高が未入力（着地見込みが出せない例）
//   A-104 予算超過（すでに実績が予算を超えている）

const PROJECTS = [
  {
    code: "A-101", name: "グリーンヒル分譲住宅 新築工事",
    client: "グリーンヒル開発株式会社", location: "広島市安佐南区緑井5-1-1",
    manager: "田中 一郎", contract: 48000000,
    start: "2026-02-02", end: "2026-11-30", status: "active",
    progress: [["2026-04", 25], ["2026-05", 40], ["2026-06", 50], ["2026-07", 60]],
  },
  {
    code: "A-102", name: "サンライズマンション 大規模修繕工事",
    client: "サンライズマンション管理組合", location: "広島市西区庚午北3-8-20",
    manager: "佐藤 健太", contract: 62000000,
    start: "2026-02-16", end: "2026-10-31", status: "active",
    progress: [["2026-04", 20], ["2026-05", 30], ["2026-06", 40], ["2026-07", 50]],
  },
  {
    code: "A-103", name: "川口様邸 増築工事",
    client: "川口 建志 様", location: "東広島市西条町御薗宇1234",
    manager: "高橋 直樹", contract: 8500000,
    start: "2026-06-01", end: "2026-09-30", status: "active",
    progress: [],
  },
  {
    code: "A-104", name: "みなと物流倉庫 改修工事",
    client: "みなと物流株式会社", location: "広島市南区宇品海岸2-4-7",
    manager: "田中 一郎", contract: 21000000,
    start: "2026-02-09", end: "2026-08-31", status: "active",
    progress: [["2026-05", 60], ["2026-06", 80], ["2026-07", 90]],
  },
];

// 実行予算（工種 × 仕入先）。合計が各工事の予算になる
const BUDGETS = {
  "A-101": [
    ["0610", "仮設工事",       "V007", 1500000],
    ["0620", "土工事",         "V010", 1000000],
    ["0630", "地業工事",       "V006",  700000],
    ["0640", "鉄筋工事",       "V002", 2000000],
    ["0650", "型枠工事",       "V001", 1300000],
    ["0660", "コンクリート工事","V006", 2300000],
    ["0680", "木工事",         "V008", 6200000],
    ["0690", "屋根工事",       "V001", 1700000],
    ["0700", "外装工事",       "V004", 3600000],
    ["0710", "内装工事",       "V001", 4800000],
    ["0760", "電気設備工事",   "V003", 2900000],
    ["0770", "給排水設備工事", "V005", 2600000],
    ["0780", "空調設備工事",   "V009", 1800000],
    ["0750", "建具工事",       "V001", 2100000],
    ["0790", "外構工事",       "V010", 1000000],
    ["0810", "その他",         null,    500000],
  ],
  "A-102": [
    ["0610", "仮設工事",       "V007", 5200000],
    ["0730", "防水工事",       "V001", 8600000],
    ["0700", "外装工事",       "V004", 4500000],
    ["0720", "塗装工事",       "V004", 9800000],
    ["0750", "建具工事",       "V001", 6400000],
    ["0770", "給排水設備工事", "V005", 5900000],
    ["0760", "電気設備工事",   "V003", 2400000],
    ["0810", "その他",         null,   2800000],
    ["0810", "その他",         null,   1400000],
  ],
  "A-103": [
    ["0800", "解体工事",       "V010",  450000],
    ["0630", "地業工事",       "V006",  700000],
    ["0680", "木工事",         "V008", 2300000],
    ["0690", "屋根工事",       "V001",  600000],
    ["0710", "内装工事",       "V001", 1100000],
    ["0760", "電気設備工事",   "V003",  400000],
    ["0770", "給排水設備工事", "V005",  500000],
    ["0810", "その他",         null,    250000],
  ],
  "A-104": [
    ["0800", "解体工事",       "V010", 1200000],
    ["0670", "鉄骨工事",       "V002", 4000000],
    ["0690", "屋根工事",       "V001", 3400000],
    ["0700", "外装工事",       "V004", 2000000],
    ["0760", "電気設備工事",   "V003", 2100000],
    ["0780", "空調設備工事",   "V009", 1400000],
    ["0710", "内装工事",       "V001",  800000],
    ["0810", "その他",         null,    800000],
    ["0810", "その他",         null,    300000],
  ],
};

// 実績原価。[日付, 工種コード, 区分, 仕入先コード(なければnull), 品名, 金額]
// 月をまたいで並べてあるので「月別の原価推移」グラフが動く
const COSTS = {
  "A-101": [
    ["2026-02-20", "0610", "subcontract", "V007", "外部足場 組立・解体",        1450000],
    ["2026-02-25", "0620", "subcontract", "V010", "掘削・残土処分",              980000],
    ["2026-03-05", "0630", "material",    "V006", "捨てコンクリート",            620000],
    ["2026-03-12", "0640", "material",    "V002", "異形鉄筋 D13/D10",           1880000],
    ["2026-03-18", "0650", "subcontract", "V001", "基礎型枠 建込",              1240000],
    ["2026-03-25", "0660", "material",    "V006", "生コンクリート 24-18-20",    2150000],
    ["2026-04-10", "0680", "material",    "V008", "構造材 プレカット一式",      3420000],
    ["2026-04-28", "0680", "labor",       null,   "大工手間（自社）",           1760000],
    ["2026-05-15", "0690", "subcontract", "V001", "ガルバリウム鋼板葺き",       1530000],
    ["2026-05-28", "0700", "subcontract", "V004", "サイディング張り",           2080000],
    ["2026-06-16", "0760", "subcontract", "V003", "電気配線工事",               1340000],
    ["2026-06-26", "0770", "subcontract", "V005", "給排水配管工事",             1180000],
    ["2026-07-14", "0710", "subcontract", "V001", "石膏ボード張り",              890000],
    ["2026-07-22", "0810", "expense",     null,   "現場管理費・諸経費",          280000],
  ],
  "A-102": [
    ["2026-02-24", "0610", "subcontract", "V007", "全面足場・養生",             4850000],
    ["2026-03-10", "0610", "subcontract", "V007", "足場 追加（バルコニー側）",   620000],
    ["2026-03-26", "0730", "subcontract", "V001", "屋上ウレタン防水",           3780000],
    ["2026-04-14", "0700", "subcontract", "V004", "下地補修・タイル打診",       2940000],
    ["2026-04-27", "0720", "subcontract", "V004", "外壁塗装（一次）",           5600000],
    ["2026-05-18", "0720", "subcontract", "V004", "外壁塗装 追加（劣化部）",    2180000],
    ["2026-05-29", "0730", "material",    "V001", "シーリング材・副資材",       1240000],
    ["2026-06-12", "0750", "subcontract", "V001", "玄関ドア交換 32戸",          4160000],
    ["2026-06-25", "0770", "subcontract", "V005", "排水管更生",                 2890000],
    ["2026-07-10", "0810", "labor",       null,   "現場常駐 監理手間",          1650000],
    ["2026-07-24", "0810", "expense",     null,   "仮設電気・水道・産廃処分",    640000],
  ],
  "A-103": [
    ["2026-06-08", "0800", "subcontract", "V010", "既存外壁 部分解体",           380000],
    ["2026-06-22", "0680", "material",    "V008", "増築部 構造材",               720000],
    ["2026-07-06", "0630", "material",    "V006", "生コン・鉄筋",                450000],
    ["2026-07-18", "0680", "labor",       null,   "大工手間（自社）",            350000],
  ],
  "A-104": [
    ["2026-02-18", "0800", "subcontract", "V010", "内部間仕切 解体・撤去",      1320000],
    ["2026-03-09", "0670", "material",    "V002", "鉄骨補強材",                 2480000],
    ["2026-03-24", "0670", "subcontract", "V002", "鉄骨建方・溶接",             1950000],
    ["2026-04-15", "0690", "subcontract", "V001", "折板屋根 葺き替え",          3640000],
    ["2026-04-26", "0700", "subcontract", "V004", "外壁パネル張替",             2180000],
    ["2026-05-13", "0760", "subcontract", "V003", "LED照明・動力盤更新",        2260000],
    ["2026-05-27", "0780", "subcontract", "V009", "空調機更新 4台",             1480000],
    ["2026-06-17", "0710", "subcontract", "V001", "床塗床仕上げ",                890000],
    ["2026-06-27", "0810", "labor",       null,   "現場管理 手間",               420000],
    ["2026-07-20", "0810", "expense",     null,   "産廃処分・警備",              180000],
  ],
};

// 未請求の発注残（発注済だがまだ請求が来ていない分）。社長画面の「未請求の発注残」に出る
const ORDERS = [
  { project: "A-101", vendor: "V009", wt: "0780", name: "空調設備工事",   date: "2026-06-20", due: "2026-08-20", status: "ordered",   desc: "業務用エアコン設置一式", amount: 1800000, deliveredRate: 0 },
  { project: "A-101", vendor: "V001", wt: "0750", name: "建具工事",       date: "2026-06-28", due: "2026-08-31", status: "partial",   desc: "サッシ・内部建具",       amount: 2100000, deliveredRate: 0.5 },
  { project: "A-102", vendor: "V005", wt: "0770", name: "給排水設備工事", date: "2026-07-06", due: "2026-09-15", status: "ordered",   desc: "排水管更生（2工区）",     amount: 3000000, deliveredRate: 0 },
  { project: "A-104", vendor: "V003", wt: "0760", name: "電気設備工事",   date: "2026-05-01", due: "2026-05-25", status: "completed", desc: "LED照明・動力盤更新",     amount: 2260000, deliveredRate: 1 },
];

// ─── 仕入の振り分け（受領した請求書）────────────────────────────────────────
//
// デモの主役。みなと鋼材の1枚に3現場ぶんの伝票が混ざっている状態を作る。
// 返品行（マイナス・仕入行）と、入金行（仕入以外）の両方を含めてある。

const RECEIVED_SENT = {
  vendor: "V002",
  invoiceDate: "2026-07-20",
  dueDate: "2026-08-31",
  recipient: "S01", // 田中 一郎（未回答）
  items: [
    ["A-7781", "2026-07-10", "グリーンヒル 1号棟", "異形鉄筋 D13 (5.5m)", 200, "本",  1180,  236000, false],
    ["A-7781", "2026-07-10", "グリーンヒル 1号棟", "異形鉄筋 D10 (5.5m)", 120, "本",   760,   91200, false],
    ["A-7802", "2026-07-14", "サンライズ 外部",     "軽量アングル L-50",    80, "本",  2400,  192000, false],
    ["A-7802", "2026-07-14", "サンライズ 外部",     "溶接棒 低水素系",       5, "箱",  4200,   21000, false],
    ["A-7830", "2026-07-18", "みなと倉庫",          "H鋼 H-200×100",       12, "本", 28500,  342000, false],
    ["A-7830", "2026-07-18", "みなと倉庫",          "デッキプレート",       40, "枚",  6800,  272000, false],
    ["A-7830", "2026-07-18", "みなと倉庫",          "運搬費",                1, "式", 35000,   35000, false],
    ["A-7830", "2026-07-18", "みなと倉庫",          "H鋼 H-200×100（返品）", -1, "本", 28500, -28500, false],
    [null,     null,         null,                  "入金 振込",             1, "式",     0, -450000, true],
  ],
};

const RECEIVED_DRAFT = {
  vendor: "V001",
  invoiceDate: "2026-07-24",
  dueDate: "2026-08-25",
  items: [
    ["B-2210", "2026-07-15", "川口様邸", "石膏ボード 12.5mm", 60, "枚", 980,  58800, false],
    ["B-2210", "2026-07-15", "川口様邸", "軽量下地材 一式",    1, "式", 47000, 47000, false],
  ],
};

const USERS = [
  { email: "demo@mirai-kensetsu.example", name: "みらい建設 デモ", password: "MiraiDemo2026" },
];

// ─── 投入 ────────────────────────────────────────────────────────────────────

const DEMO_CODES = PROJECTS.map((p) => p.code);
const q = (sql, params) => pool.query(sql, params);
const yen = (n) => "¥" + n.toLocaleString("ja-JP");

async function guard() {
  const { rows: v } = await q("SELECT COUNT(*)::int n FROM vendors");
  const { rows: p } = await q("SELECT project_code, name FROM projects WHERE project_code <> ALL($1)", [DEMO_CODES]);
  const problems = [];
  if (v[0].n > 30) problems.push(`仕入先が${v[0].n}件あります（実マスタの可能性）`);
  if (p.length > 0) problems.push(`デモ以外の工事が${p.length}件あります（例: ${p[0].name}）`);
  if (problems.length === 0) return;

  console.error("\n⛔ 実データが入っているデータベースの可能性があります:");
  problems.forEach((x) => console.error("   - " + x));
  if (!force) {
    console.error("\n   中止しました。意図した操作であれば DEMO_SEED_CONFIRM=yes を付けて再実行してください。\n");
    await pool.end();
    process.exit(1);
  }
  console.error("   DEMO_SEED_CONFIRM=yes が指定されているため続行します。\n");
}

async function main() {
  await guard();

  // 既存のデモ工事を消す（cascadeで予算・原価・発注・仕入伝票も消える）
  await q("DELETE FROM received_invoices");
  await q("DELETE FROM projects WHERE project_code = ANY($1)", [DEMO_CODES]);

  // 会社情報
  await q("DELETE FROM company_settings");
  const ck = Object.keys(COMPANY);
  await q(
    `INSERT INTO company_settings (${ck.join(",")}) VALUES (${ck.map((_, i) => `$${i + 1}`).join(",")})`,
    ck.map((k) => COMPANY[k]),
  );

  // 工種（既存の初期データが無ければ入れる）
  const { rows: wtCount } = await q("SELECT COUNT(*)::int n FROM work_types");
  if (wtCount[0].n === 0) {
    throw new Error("work_types が空です。先に `node lib/db/seed.mjs` を実行してください。");
  }
  const { rows: wtRows } = await q("SELECT id, code, name FROM work_types");
  const wtByCode = new Map(wtRows.map((r) => [r.code, r]));

  // 担当者
  for (const s of STAFF) {
    await q(
      `INSERT INTO staff_members (code, name, is_active) VALUES ($1,$2,true)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true`,
      [s.code, s.name],
    );
  }
  const { rows: staffRows } = await q("SELECT id, code, name FROM staff_members");
  const staffByCode = new Map(staffRows.map((r) => [r.code, r]));

  // 仕入先
  for (const v of VENDORS) {
    const { rows } = await q("SELECT id FROM vendors WHERE code = $1", [v.code]);
    if (rows.length) {
      await q(
        `UPDATE vendors SET name=$2, closing_day=$3, payment_months=$4, payment_day=$5, updated_at=now() WHERE code=$1`,
        [v.code, v.name, v.closing, v.months, v.payday],
      );
    } else {
      await q(
        `INSERT INTO vendors (code, name, closing_day, payment_months, payment_day, address)
         VALUES ($1,$2,$3,$4,$5,'')`,
        [v.code, v.name, v.closing, v.months, v.payday],
      );
    }
  }
  const { rows: vendorRows } = await q("SELECT id, code, name FROM vendors WHERE code = ANY($1)", [VENDORS.map((v) => v.code)]);
  const vByCode = new Map(vendorRows.map((r) => [r.code, r]));

  // ログイン
  for (const u of USERS) {
    await q(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'admin')
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash`,
      [u.email, u.name, hashPassword(u.password)],
    );
  }

  // 工事・予算・原価・出来高
  const projectIds = new Map();
  const summary = [];

  for (const p of PROJECTS) {
    const latest = p.progress.length ? p.progress[p.progress.length - 1][1] : null;
    const { rows } = await q(
      `INSERT INTO projects
         (project_code, name, client_name, location, contract_amount, status,
          start_date, end_date, site_manager, progress_rate, tax_rate, tax_excluded_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,10,$5) RETURNING id`,
      [p.code, p.name, p.client, p.location, p.contract, p.status, p.start, p.end, p.manager, latest],
    );
    const pid = rows[0].id;
    projectIds.set(p.code, pid);

    let budgetTotal = 0;
    let sort = 0;
    for (const [wtCode, wtName, vCode, amount] of BUDGETS[p.code]) {
      const vendor = vCode ? vByCode.get(vCode) : null;
      await q(
        `INSERT INTO budget_items
           (project_id, work_type_code, work_type_name, supplier_code, supplier_name, vendor_id,
            initial_budget, revised_budget, original_budget_amount, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$7,$8)`,
        [pid, wtCode, wtName, vCode ?? "", vendor?.name ?? "", vendor?.id ?? null, amount, sort++],
      );
      budgetTotal += amount;
    }

    // 原価。6月・7月の仕入先ぶんは仕入伝票から発生した形にする（仕入集計に出る）
    let actualTotal = 0;
    const invoiceGroups = new Map(); // `${vendorCode}|${yyyy-mm}` -> 行
    for (const [date, wtCode, category, vCode, desc, amount] of COSTS[p.code]) {
      const ym = date.slice(0, 7);
      const fromInvoice = vCode && (ym === "2026-06" || ym === "2026-07");
      if (fromInvoice) {
        const key = `${vCode}|${ym}`;
        if (!invoiceGroups.has(key)) invoiceGroups.set(key, []);
        invoiceGroups.get(key).push({ date, wtCode, category, vCode, desc, amount });
      } else {
        await q(
          `INSERT INTO cost_items
             (project_id, category, description, vendor, quantity, unit, unit_price, amount,
              incurred_date, work_type_id, vendor_id, source_type)
           VALUES ($1,$2,$3,$4,1,'式',$5,$5,$6,$7,$8,'manual')`,
          [pid, category, desc, vCode ? vByCode.get(vCode).name : null, amount, date,
           wtByCode.get(wtCode)?.id ?? null, vCode ? vByCode.get(vCode).id : null],
        );
      }
      actualTotal += amount;
    }

    // 仕入伝票 → 原価
    for (const [key, lines] of invoiceGroups) {
      const [vCode, ym] = key.split("|");
      const vendor = vByCode.get(vCode);
      const last = lines[lines.length - 1].date;
      const subtotal = lines.reduce((s, l) => s + l.amount, 0);
      const tax = Math.floor(subtotal * 0.1);
      const voucher = `SP${ym.replace("-", "")}${String(pid).padStart(2, "0")}${vCode.slice(1)}`;
      const { rows: inv } = await q(
        `INSERT INTO purchase_invoices
           (voucher_number, project_id, vendor_id, purchase_date, payment_due_date, status,
            subtotal, tax_amount, total_amount)
         VALUES ($1,$2,$3,$4,$5,'confirmed',$6,$7,$8) RETURNING id`,
        [voucher, pid, vendor.id, last, null, subtotal, tax, subtotal + tax],
      );
      const invId = inv[0].id;
      let ln = 1;
      for (const l of lines) {
        const { rows: ci } = await q(
          `INSERT INTO cost_items
             (project_id, category, description, vendor, quantity, unit, unit_price, amount,
              incurred_date, invoice_number, work_type_id, vendor_id, source_type, source_id)
           VALUES ($1,$2,$3,$4,1,'式',$5,$5,$6,$7,$8,$9,'purchase_invoice',$10) RETURNING id`,
          [pid, l.category, l.desc, vendor.name, l.amount, l.date, voucher,
           wtByCode.get(l.wtCode)?.id ?? null, vendor.id, invId],
        );
        await q(
          `INSERT INTO purchase_invoice_items
             (purchase_invoice_id, line_number, category, work_type_id, description,
              quantity, unit, unit_price, amount, tax_rate, cost_item_id)
           VALUES ($1,$2,$3,$4,$5,1,'式',$6,$6,10,$7)`,
          [invId, ln++, l.category, wtByCode.get(l.wtCode)?.id ?? null, l.desc, l.amount, ci[0].id],
        );
      }
    }

    // 出来高の月次履歴
    for (const [ym, rate] of p.progress) {
      await q(
        `INSERT INTO project_progress_records (project_id, year_month, progress_rate, recorded_by)
         VALUES ($1,$2,$3,$4)`,
        [pid, ym, rate, p.manager],
      );
    }

    summary.push({ code: p.code, name: p.name, contract: p.contract, budget: budgetTotal, actual: actualTotal, progress: latest });
  }

  // 発注（未請求の発注残）
  let orderSeq = 1;
  for (const o of ORDERS) {
    const pid = projectIds.get(o.project);
    const vendor = vByCode.get(o.vendor);
    const tax = Math.floor(o.amount * 0.1);
    const { rows } = await q(
      `INSERT INTO purchase_orders
         (order_number, project_id, vendor_id, order_date, expected_delivery_date, status,
          order_name, start_date, subtotal, tax_amount, total_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$4,$8,$9,$10) RETURNING id`,
      [`PO-2026${String(orderSeq++).padStart(4, "0")}`, pid, vendor.id, o.date, o.due, o.status,
       o.name, o.amount, tax, o.amount + tax],
    );
    await q(
      `INSERT INTO purchase_order_items
         (purchase_order_id, line_number, category, work_type_id, description,
          quantity, unit, unit_price, amount, tax_rate, delivered_quantity)
       VALUES ($1,1,'subcontract',$2,$3,1,'式',$4,$4,10,$5)`,
      [rows[0].id, wtByCode.get(o.wt)?.id ?? null, o.desc, o.amount, o.deliveredRate],
    );
  }

  // 仕入の振り分け：現場に送信済み（未回答）
  await insertReceived(RECEIVED_SENT, vByCode, staffByCode, "sent");
  // 仕入の振り分け：未送信の下書き
  await insertReceived(RECEIVED_DRAFT, vByCode, staffByCode, "draft");

  // ─── 結果の確認 ───────────────────────────────────────────────────────────
  console.log(`\n✅ デモデータを投入しました（${COMPANY.company_name}）\n`);
  console.log("  工事                                    請負          実行予算       実績原価   出来高");
  console.log("  " + "─".repeat(88));
  let tc = 0, tb = 0, ta = 0;
  for (const s of summary) {
    tc += s.contract; tb += s.budget; ta += s.actual;
    const rate = s.budget > 0 ? ((s.actual / s.budget) * 100).toFixed(1) + "%" : "—";
    console.log(
      `  ${s.name.padEnd(30, "　").slice(0, 30)} ${yen(s.contract).padStart(13)} ${yen(s.budget).padStart(13)} ${yen(s.actual).padStart(13)}   ${s.progress != null ? s.progress + "%" : "未入力"}  (原価消化 ${rate})`,
    );
  }
  console.log("  " + "─".repeat(88));
  console.log(`  合計${" ".repeat(28)} ${yen(tc).padStart(13)} ${yen(tb).padStart(13)} ${yen(ta).padStart(13)}`);
  console.log(`\n  予定粗利 ${yen(tc - tb)}（${(((tc - tb) / tc) * 100).toFixed(1)}%）`);
  console.log(`\n  ログイン: ${USERS[0].email} / ${USERS[0].password}`);
  console.log(`  仕入の振り分け: 1件を ${staffByCode.get("S01").name} さんへ送信済（未回答）、1件は未送信\n`);

  await pool.end();
}

async function insertReceived(spec, vByCode, staffByCode, status) {
  const vendor = vByCode.get(spec.vendor);
  const purchase = spec.items.filter((i) => !i[8]);
  const adjust = spec.items.filter((i) => i[8]);
  const subtotal = purchase.reduce((s, i) => s + i[7], 0);
  const tax = Math.floor(subtotal * 0.1);
  const total = subtotal + tax + adjust.reduce((s, i) => s + i[7], 0);

  const { rows } = await q(
    `INSERT INTO received_invoices
       (vendor_id, vendor_name, invoice_date, payment_due_date, status, ai_extracted,
        amount_mismatch, subtotal, tax_amount, total_amount, sent_at)
     VALUES ($1,$2,$3,$4,$5,true,false,$6,$7,$8,$9) RETURNING id`,
    [vendor.id, vendor.name, spec.invoiceDate, spec.dueDate, status, subtotal, tax, total,
     status === "sent" ? new Date(Date.now() - 2 * 86400000) : null],
  );
  const rid = rows[0].id;

  let ln = 1;
  for (const [slip, date, to, desc, qty, unit, price, amount, nonPurchase] of spec.items) {
    await q(
      `INSERT INTO received_invoice_items
         (received_invoice_id, line_number, slip_no, delivery_date, delivery_to, category,
          description, quantity, unit, unit_price, amount, tax_rate, project_id, is_non_purchase)
       VALUES ($1,$2,$3,$4,$5,'material',$6,$7,$8,$9,$10,10,NULL,$11)`,
      [rid, ln++, slip, date, to, desc, qty, unit, price, amount, nonPurchase],
    );
  }

  if (spec.recipient) {
    await q(
      `INSERT INTO received_invoice_recipients (received_invoice_id, staff_member_id) VALUES ($1,$2)`,
      [rid, staffByCode.get(spec.recipient).id],
    );
  }
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
