import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";

// ─── 工事原価計算書 ──────────────────────────────────────────────────────────
//
// 工事詳細の基本情報タブ。現場の人が慣れている Excel「工事原価計算書」と同じ並び・見た目にする
// （罫線の表、費目ごとの見出し行、月ごとの列、右端に合計・単価・金額）。
// 集計はサーバ（/api/cost-sheet/:projectId）。職人の単価だけはこの表の中で直接入れる。

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Worker = {
  staffMemberId: number;
  name: string;
  dayRate: number;
  overtimeRate: number;
  earlyRate: number;
  manDays: Record<string, number>;
  early: Record<string, number>;
  overtime: Record<string, number>;
  manDaysTotal: number;
  earlyTotal: number;
  overtimeTotal: number;
  amount: number;
};

type VendorRow = {
  vendorId: number | null;
  name: string;
  byMonth: Record<string, number>;
  total: number;
  budget: number | null;
};

type Section = "labor" | "subcontract" | "material" | "expense";

type CostSheetData = {
  project: {
    name: string;
    projectCode: string;
    clientName: string;
    siteManager: string | null;
    location: string;
    startDate: string | null;
    endDate: string | null;
  };
  months: string[];
  labor: { rows: Worker[]; total: number };
  sections: Record<Section, { rows: VendorRow[]; total: number }>;
  summary: {
    costTotal: number;
    laborTotal: number;
    contractAmount: number;
    estimateAmount: number | null;
    invoicedAmount: number;
    grossProfit: number;
    grossProfitRate: number | null;
    laborRate: number | null;
    materialRate: number | null;
  };
};

const SECTIONS: { key: Section; label: string; budgetLabel: string }[] = [
  { key: "labor", label: "外注労務費", budgetLabel: "金額" },
  { key: "subcontract", label: "外注費", budgetLabel: "外注金額" },
  { key: "material", label: "材料費", budgetLabel: "金額" },
  { key: "expense", label: "損料等及び消耗品", budgetLabel: "金額" },
];

const num = (n: number) => (n ? n.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) : "");
const yen = (n: number) => (n ? Math.round(n).toLocaleString("ja-JP") : "");

/** 和暦の日付（工期の表示。Excel は「令和 8年7月21日」） */
function wareki(d: string | null) {
  if (!d) return "";
  const dt = new Date(`${d}T00:00:00`);
  return dt.toLocaleDateString("ja-JP-u-ca-japanese", { era: "long", year: "numeric", month: "long", day: "numeric" });
}

/**
 * データのある月だけだと「7月の次が9月」のように飛んで読みにくい（2026-11-12 アイさん）。
 * 最初の月から最後の月まで、間の月も空の列として続けて並べる（Excel と同じ）。
 */
function fillMonths(months: string[]): string[] {
  if (months.length === 0) return [];
  const sorted = [...months].sort();
  const [fy, fm] = sorted[0].split("-").map(Number);
  const [ly, lm] = sorted[sorted.length - 1].split("-").map(Number);
  const out: string[] = [];
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m === 12 ? (y++, m = 1) : m++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/** 月の列見出し。年が変わる列と最初の列だけ年を付ける */
function monthLabels(months: string[]) {
  return months.map((m, i) => {
    const [y, mo] = m.split("-");
    const showYear = i === 0 || months[i - 1].slice(0, 4) !== y;
    return { key: m, top: showYear ? `${y}年` : "", label: `${Number(mo)}月` };
  });
}

// 罫線は Excel に寄せて細い灰色の格子。見出しの行は薄い灰色
const cell = "border-r border-b border-slate-300 px-2 py-1";
const head = `${cell} bg-slate-100 text-slate-600 font-medium text-center whitespace-nowrap`;
const numCell = `${cell} text-right tabular-nums`;
const monthW = "min-w-[4.5rem]";

// 横に長い工事でも、左の「項目・班名」と右の「合計・単価・金額」は動かさない（2026-11-12 アイさん）。
// 月の列だけが横に流れる。固定する列は幅を決めておき、背景を塗って下を流れる数字を隠す。
const stickL1 = "sticky left-0 z-10 w-20 min-w-20";
const stickL2 = "sticky left-20 z-10 min-w-36 max-w-36 truncate shadow-[4px_0_6px_-4px_rgba(0,0,0,0.15)]";
const stickR3 = "sticky right-56 z-10 w-24 min-w-24 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]"; // 合計
const stickR2 = "sticky right-28 z-10 w-28 min-w-28"; // 単価・残高
const stickR1 = "sticky right-0 z-10 w-28 min-w-28"; // 金額

function RateInput({ value, onSave }: { value: number; onSave: (v: number) => Promise<void> }) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    const n = draft.trim() === "" ? 0 : Number(draft.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0 || n === value) {
      setDraft(value ? String(value) : "");
      return;
    }
    setSaving(true);
    await onSave(n);
    setSaving(false);
  };
  return (
    <div className="relative">
      <input
        inputMode="numeric"
        value={draft}
        placeholder="単価"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={`w-24 text-right tabular-nums rounded border px-1.5 py-0.5 text-sm ${
          value ? "border-transparent bg-transparent hover:border-slate-300" : "border-amber-300 bg-amber-50"
        } focus:border-primary focus:bg-white focus:outline-none`}
      />
      {saving && <Loader2 className="w-3 h-3 animate-spin absolute -left-4 top-1.5 text-slate-400" />}
    </div>
  );
}

export function CostSheet({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const queryKey = ["/api/cost-sheet", projectId];
  const { data, isLoading, isError } = useQuery<CostSheetData>({
    queryKey,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/cost-sheet/${projectId}`);
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
  });

  if (isLoading) {
    return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  }
  if (isError || !data) {
    return <div className="py-6 text-sm text-destructive">工事原価計算書を読み込めませんでした。</div>;
  }

  const { project, labor, sections, summary } = data;
  const months = monthLabels(fillMonths(data.months));
  const monthCols = months.length > 0 ? months : [{ key: "-", top: "", label: "" }];
  // 項目・班名/仕入先・月…・合計・単価/残高・金額
  const colCount = 2 + monthCols.length + 3;

  const saveRate = async (w: Worker, patch: Partial<Pick<Worker, "dayRate" | "overtimeRate" | "earlyRate">>) => {
    const r = await fetch(`${BASE}/api/cost-sheet/${projectId}/rates/${w.staffMemberId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      toast({ title: "単価を保存できませんでした", variant: "destructive" });
      return;
    }
    await qc.invalidateQueries({ queryKey });
  };

  const sectionHeader = (label: string, nameLabel: string, midLabel: string, lastLabel: string, rowSpan: number) => (
    <tr>
      <th rowSpan={rowSpan} className={`${head} ${stickL1} align-middle whitespace-pre-line`}>{label}</th>
      <th className={`${head} ${stickL2} text-left`}>{nameLabel}</th>
      {monthCols.map((m) => <th key={m.key} className={`${head} ${monthW}`}>{m.label}</th>)}
      <th className={`${head} ${stickR3}`}>合計</th>
      <th className={`${head} ${stickR2}`}>{midLabel}</th>
      <th className={`${head} ${stickR1}`}>{lastLabel}</th>
    </tr>
  );

  // 労務費の行：職人ごとに「人工」「残業」（早出があれば「早出」も）
  const laborLines: { w: Worker; kind: "day" | "early" | "overtime" }[] = [];
  for (const w of labor.rows) {
    laborLines.push({ w, kind: "day" });
    if (w.earlyTotal > 0 || w.earlyRate > 0) laborLines.push({ w, kind: "early" });
    laborLines.push({ w, kind: "overtime" });
  }
  const laborManDaysByMonth = (m: string) => labor.rows.reduce((s, w) => s + (w.manDays[m] ?? 0), 0);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
      <div className="space-y-5 text-sm text-slate-800">
        <h2 className="text-center text-lg font-bold tracking-[0.5em]">工事原価計算書</h2>

        {/* 見出し：工事名・受注先・担当者・工期 */}
        <table className="w-full border-separate border-spacing-0 border-l border-t border-slate-300">
          <tbody>
            <tr>
              <th className={`${head} w-28 tracking-[0.3em]`}>工事名</th>
              <td className={`${cell} font-semibold`} colSpan={3}>
                {project.name}
                <span className="ml-2 font-mono text-xs text-slate-400">{project.projectCode}</span>
              </td>
            </tr>
            <tr>
              <th className={`${head} tracking-[0.3em]`}>受注先</th>
              <td className={cell}>{project.clientName || "—"}</td>
              <th className={`${head} w-24`}>担当者</th>
              <td className={`${cell} w-40`}>{project.siteManager || "—"}</td>
            </tr>
            <tr>
              <th className={`${head} tracking-[0.3em]`}>工期</th>
              <td className={cell}>
                {project.startDate || project.endDate ? `${wareki(project.startDate)} ～ ${wareki(project.endDate)}` : "—"}
              </td>
              <th className={head}>工事場所</th>
              <td className={cell}>{project.location || "—"}</td>
            </tr>
          </tbody>
        </table>

        {/* 費目 × 月。月の列だけ横に流れる */}
        <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 border-l border-t border-slate-300">
          <thead>
            <tr>
              <th className={`${head} ${stickL1}`}>項目</th>
              <th className={`${head} ${stickL2} text-left`}>班名</th>
              {monthCols.map((m) => (
                <th key={m.key} className={`${head} ${monthW}`}>
                  {m.top && <div className="text-[10px] text-slate-400 leading-none">{m.top}</div>}
                  {m.label}
                </th>
              ))}
              <th className={`${head} ${stickR3}`}>合計</th>
              <th className={`${head} ${stickR2}`}>単価</th>
              <th className={`${head} ${stickR1}`}>金額</th>
            </tr>
          </thead>
          <tbody>
            {/* 労務費（出面 × 単価） */}
            {laborLines.length === 0 ? (
              <tr>
                <th className={`${head} ${stickL1} align-middle`}>労務費</th>
                <td className={`${cell} text-slate-400`} colSpan={colCount - 1}>出面がまだ入っていません（出面タブから入力）</td>
              </tr>
            ) : (
              laborLines.map(({ w, kind }, i) => {
                const byMonth = kind === "day" ? w.manDays : kind === "early" ? w.early : w.overtime;
                const total = kind === "day" ? w.manDaysTotal : kind === "early" ? w.earlyTotal : w.overtimeTotal;
                const rate = kind === "day" ? w.dayRate : kind === "early" ? w.earlyRate : w.overtimeRate;
                const field = kind === "day" ? "dayRate" : kind === "early" ? "earlyRate" : "overtimeRate";
                return (
                  <tr key={`${w.staffMemberId}-${kind}`} className={kind === "day" ? "" : "text-slate-500"}>
                    {i === 0 && (
                      <th rowSpan={laborLines.length + 1} className={`${head} ${stickL1} align-middle`}>労務費</th>
                    )}
                    <td className={`${cell} ${stickL2} bg-white whitespace-nowrap`} title={w.name}>
                      {kind === "day" ? w.name : kind === "early" ? "　早出" : "　残業"}
                    </td>
                    {monthCols.map((m) => <td key={m.key} className={numCell}>{num(byMonth[m.key] ?? 0)}</td>)}
                    <td className={`${numCell} ${stickR3} bg-white`}>{num(total)}</td>
                    <td className={`${cell} ${stickR2} bg-white text-right`}>
                      <RateInput key={rate} value={rate} onSave={(v) => saveRate(w, { [field]: v })} />
                    </td>
                    <td className={`${numCell} ${stickR1} bg-white`}>{yen(total * rate)}</td>
                  </tr>
                );
              })
            )}
            {laborLines.length > 0 && (
              <tr className="font-semibold bg-slate-50">
                <td className={`${cell} ${stickL2} bg-slate-50 text-center tracking-[0.5em]`}>合計</td>
                {monthCols.map((m) => <td key={m.key} className={numCell}>{num(laborManDaysByMonth(m.key))}</td>)}
                <td className={`${numCell} ${stickR3} bg-slate-50`}>{num(labor.rows.reduce((s, w) => s + w.manDaysTotal, 0))}</td>
                <td className={`${cell} ${stickR2} bg-slate-50`} />
                <td className={`${numCell} ${stickR1} bg-slate-50`}>{yen(labor.total)}</td>
              </tr>
            )}

            {/* 業者からの原価（確定原価のみ）。区分ごとに Excel と同じ見出し行を挟む */}
            {SECTIONS.map(({ key, label, budgetLabel }) => {
              const s = sections[key];
              return (
                <Fragment key={key}>
                  {sectionHeader(label, "仕入先", "残高", budgetLabel, Math.max(s.rows.length, 1) + 2)}
                  {s.rows.length === 0 ? (
                    <tr>
                      <td className={`${cell} ${stickL2} bg-white text-slate-300`}>—</td>
                      {monthCols.map((m) => <td key={m.key} className={cell} />)}
                      <td className={`${cell} ${stickR3} bg-white`} />
                      <td className={`${cell} ${stickR2} bg-white`} />
                      <td className={`${cell} ${stickR1} bg-white`} />
                    </tr>
                  ) : (
                    s.rows.map((r) => (
                      <tr key={`${r.vendorId ?? r.name}`}>
                        <td className={`${cell} ${stickL2} bg-white whitespace-nowrap`} title={r.name}>{r.name}</td>
                        {monthCols.map((m) => <td key={m.key} className={numCell}>{yen(r.byMonth[m.key] ?? 0)}</td>)}
                        <td className={`${numCell} ${stickR3} bg-white`}>{yen(r.total)}</td>
                        <td className={`${numCell} ${stickR2} bg-white ${r.budget != null && r.budget - r.total < 0 ? "text-destructive" : ""}`}>
                          {r.budget != null ? Math.round(r.budget - r.total).toLocaleString("ja-JP") : ""}
                        </td>
                        <td className={`${numCell} ${stickR1} bg-white`}>{yen(r.budget ?? r.total)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="font-semibold bg-slate-50">
                    <td className={`${cell} ${stickL2} bg-slate-50 text-center tracking-[0.5em]`}>合計</td>
                    {monthCols.map((m) => (
                      <td key={m.key} className={numCell}>{yen(s.rows.reduce((t, r) => t + (r.byMonth[m.key] ?? 0), 0))}</td>
                    ))}
                    <td className={`${numCell} ${stickR3} bg-slate-50`}>{yen(s.total)}</td>
                    <td className={`${cell} ${stickR2} bg-slate-50`} />
                    <td className={`${numCell} ${stickR1} bg-slate-50`}>{yen(s.rows.reduce((t, r) => t + (r.budget ?? r.total), 0))}</td>
                  </tr>
                </Fragment>
              );
            })}

            {/* 合計・粗利・費率（Excel 下段）。Excel と同じく右端の「金額」の列に縦にそろえ、
                上から1本の列で読めるようにする。消耗品費3%・諸経費10%は出さない */}
            {[
              { label: "合計", value: formatCurrency(summary.costTotal), strong: true, tone: "" },
              {
                label: "粗利",
                value: formatCurrency(summary.grossProfit),
                strong: true,
                tone: summary.grossProfit < 0 ? "text-destructive" : "text-emerald-700",
                side: summary.grossProfitRate != null ? `${summary.grossProfitRate}%` : "",
              },
              { label: "労務費率", value: summary.laborRate != null ? `${summary.laborRate}%` : "—", strong: false, tone: "" },
              { label: "材料費率", value: summary.materialRate != null ? `${summary.materialRate}%` : "—", strong: false, tone: "" },
            ].map((r, i) => (
              <tr key={r.label}>
                <th colSpan={2} className={`${head} sticky left-0 z-10 text-left tracking-[0.3em]`}>{r.label}</th>
                {monthCols.map((m) => <td key={m.key} className={cell} />)}
                <td className={`${cell} ${stickR3} bg-white`} />
                <td className={`${numCell} ${stickR2} bg-white text-xs text-slate-500`}>{"side" in r ? r.side : ""}</td>
                <td className={`${numCell} ${stickR1} bg-white ${r.strong ? "font-semibold" : ""} ${r.tone}`}>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div>
          <table className="w-full border-separate border-spacing-0 border-l border-t border-slate-300">
            <thead>
              <tr>
                <th className={head}>見積金額</th>
                <th className={head}>決定金額</th>
                <th className={head}>実行金額</th>
                <th className={head}>請求金額</th>
                <th className={head}>純利益</th>
                <th className={head}>利益率</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={numCell}>{summary.estimateAmount != null ? formatCurrency(summary.estimateAmount) : "—"}</td>
                <td className={numCell}>{formatCurrency(summary.contractAmount)}</td>
                <td className={numCell}>{formatCurrency(summary.costTotal)}</td>
                <td className={numCell}>{formatCurrency(summary.invoicedAmount)}</td>
                <td className={`${numCell} font-semibold ${summary.grossProfit < 0 ? "text-destructive" : ""}`}>
                  {formatCurrency(summary.grossProfit)}
                </td>
                <td className={numCell}>{summary.grossProfitRate != null ? `${summary.grossProfitRate}%` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-400">
          業者からの原価は確定原価（請求書）だけを数えています。労務費は出面の人工×単価で、単価は黄色の欄に直接入れられます。
        </p>
      </div>
    </div>
  );
}
