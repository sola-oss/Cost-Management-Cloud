import { Fragment, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, ScanLine } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { pathAllowed, useRole } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";

// ─── 工事原価計算書 ──────────────────────────────────────────────────────────
//
// 工事詳細の基本情報タブ。現場の人が慣れている Excel「工事原価計算書」と同じ並び・見た目にする
// （罫線の表、費目ごとの見出し行、月ごとの列、右端に合計・単価・金額）。
// 集計はサーバ（/api/cost-sheet/:projectId）。職人の単価と、業者×月のマス（外注労務費・外注費・材料費・損料等）は
// この表の中で直接打てる。マスに打った金額は仮原価（請求書待ち）として入り、色を変えて出す。
// 請求書をスキャンすると、表の下の「仮と請求書の照合」で突き合わせる（差が無ければ自動で確定）。

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Worker = {
  craftsmanId: number;
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
  provByMonth: Record<string, number>;
  lockedMonths: string[];
  total: number;
  budget: number | null;
};

type Section = "labor" | "subcontract" | "material" | "expense";

type Match = {
  vendorId: number;
  vendorName: string;
  month: string;
  invoiceMonth: string | null;
  provisional: number;
  invoice: number | null;
  difference: number | null;
  status: "settled" | "review" | "auto" | "waiting";
  invoiceId: number | null;
};

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
  vendors: { id: number; name: string }[];
  matches: Match[];
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

/**
 * 業者×月のマス。Excel のようにそのまま金額を打つ（Enter か、ほかを押すと保存）。
 * 仮（請求書待ち）の金額は黄色、請求書で確定した月は打てない（灰色の数字のまま）。
 */
/**
 * Excel のように矢印キー・Enter でマスを移る（2026-11-16 アイさん）。
 * マスには data-cs="行:列" を付け、その方向にある次の打てるマスへ移る（確定済みで打てないマスは飛ばす）。
 */
function moveFocus(from: HTMLElement, dRow: number, dCol: number) {
  const pos = from.dataset.cs?.split(":").map(Number);
  const table = from.closest("table");
  if (!pos || !table) return false;
  let [r, c] = pos;
  for (let i = 0; i < 200; i++) {
    r += dRow;
    c += dCol;
    if (r < 0 || c < 0) return false;
    const next = table.querySelector<HTMLInputElement>(`input[data-cs="${r}:${c}"]`);
    if (next) {
      next.focus();
      return true;
    }
  }
  return false;
}

function CellInput({
  value,
  prov,
  locked,
  pos,
  onSave,
}: {
  value: number;
  prov: number;
  locked: boolean;
  pos: string;
  onSave: (v: number) => Promise<boolean>;
}) {
  const shown = value ? String(Math.round(value)) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (locked) {
    return (
      <div className="text-right tabular-nums" title="請求書で確定、または照合の確認待ちの月です（下の一覧・仕入入力で直します）">
        {yen(value)}
      </div>
    );
  }
  const commit = async () => {
    if (draft == null) return;
    const t = draft.trim().replace(/,/g, "");
    const n = t === "" ? 0 : Number(t);
    if (!Number.isFinite(n) || n < 0 || Math.round(n) === Math.round(value)) {
      setDraft(null);
      return;
    }
    setSaving(true);
    const ok = await onSave(Math.round(n));
    setSaving(false);
    setDraft(null);
    void ok;
  };
  const tone = prov > 0 ? "bg-amber-50 text-amber-800" : "bg-transparent";
  return (
    <div className="relative">
      <input
        inputMode="numeric"
        value={draft ?? (value ? Math.round(value).toLocaleString("ja-JP") : "")}
        data-cs={pos}
        onFocus={(e) => {
          setDraft(shown);
          // Excel と同じく、打ち始めると前の数字に置きかわるよう全体を選んでおく
          const el = e.target;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          const el = e.target as HTMLInputElement;
          const dir: Record<string, [number, number]> = {
            ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Enter: [e.shiftKey ? -1 : 1, 0],
          };
          const d = dir[e.key];
          if (d) {
            e.preventDefault();
            if (!moveFocus(el, d[0], d[1])) el.blur();
            return;
          }
          if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
        title={prov > 0 ? `仮（請求書待ち）${Math.round(prov).toLocaleString("ja-JP")}円` : undefined}
        className={`w-full min-w-[4.5rem] text-right tabular-nums rounded px-1 py-0.5 text-sm border border-transparent hover:border-slate-300 focus:border-primary focus:bg-white focus:outline-none ${tone}`}
      />
      {saving && <Loader2 className="w-3 h-3 animate-spin absolute left-0.5 top-1.5 text-slate-400" />}
    </div>
  );
}

const STATUS_LABEL: Record<Match["status"], { label: string; tone: string }> = {
  review: { label: "確認待ち", tone: "bg-amber-100 text-amber-800" },
  waiting: { label: "請求書待ち", tone: "bg-slate-100 text-slate-600" },
  auto: { label: "確定", tone: "bg-emerald-50 text-emerald-700" },
  settled: { label: "確定", tone: "bg-emerald-50 text-emerald-700" },
};
/** 仕入先の名前を比べるときの形（空白・株式会社・(株) などを外す） */
const vendorKey = (n: string) =>
  n.normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/株式会社|有限会社|合同会社|\(株\)|\(有\)|\(同\)/g, "")
    .toLowerCase();

const monthJa = (m: string | null) => (m ? `${Number(m.slice(5))}月` : "");

export function CostSheet({ projectId }: { projectId: number }) {
  const role = useRole();
  // 仕入先を足した行（まだ金額が無いので、サーバの表には出てこない）
  const [added, setAdded] = useState<Record<Section, { vendorId: number; name: string }[]>>({
    labor: [], subcontract: [], material: [], expense: [],
  });
  // 仕入先がマスタに無いとき、その場で登録する窓（どの費目に足すか）
  const [newVendorFor, setNewVendorFor] = useState<Section | null>(null);
  const [newVendor, setNewVendor] = useState({ name: "", kana: "" });
  const [creatingVendor, setCreatingVendor] = useState(false);
  const vendorNameRef = useRef<HTMLInputElement>(null);
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
    const r = await fetch(`${BASE}/api/cost-sheet/${projectId}/rates/${w.craftsmanId}`, {
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

  const saveCell = async (category: Section, vendorId: number, month: string, amount: number) => {
    const r = await fetch(`${BASE}/api/cost-sheet/${projectId}/cells`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, vendorId, month, amount }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      toast({ title: "金額を保存できませんでした", description: body.message, variant: "destructive" });
      return false;
    }
    await qc.invalidateQueries({ queryKey });
    return true;
  };

  const settle = async (m: Match) => {
    const r = await fetch(`${BASE}/api/cost-sheet/${projectId}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: m.vendorId, month: m.month }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      toast({ title: "確定できませんでした", description: body.message, variant: "destructive" });
      return;
    }
    toast({ title: `${m.vendorName} ${monthJa(m.month)}分を請求書の金額で確定しました` });
    await qc.invalidateQueries({ queryKey });
  };

  const addRow = (key: Section, v: { id: number; name: string }) =>
    setAdded((prev) => ({ ...prev, [key]: [...prev[key].filter((a) => a.vendorId !== v.id), { vendorId: v.id, name: v.name }] }));

  const createVendor = async () => {
    if (!newVendorFor || !newVendor.name.trim()) return;
    setCreatingVendor(true);
    const r = await fetch(`${BASE}/api/cost-sheet/${projectId}/vendors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newVendor),
    });
    setCreatingVendor(false);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast({ title: "仕入先を登録できませんでした", description: body.message, variant: "destructive" });
      return;
    }
    addRow(newVendorFor, body);
    toast({ title: body.existed ? `「${body.name}」はもう登録されていたので、それを使います` : `「${body.name}」を仕入先に登録しました` });
    setNewVendorFor(null);
    setNewVendor({ name: "", kana: "" });
    await qc.invalidateQueries({ queryKey });
  };

  // 登録しようとしている名前と同じ・似た仕入先（「㈱」の有無や空白の違いも同じとみなす）
  const typedKey = vendorKey(newVendor.name);
  const sameVendor = typedKey ? data.vendors.find((v) => vendorKey(v.name) === typedKey) : undefined;
  const similarVendors = typedKey.length >= 2 && !sameVendor
    ? data.vendors.filter((v) => {
        const k = vendorKey(v.name);
        return k.length >= 2 && (k.includes(typedKey) || typedKey.includes(k));
      }).slice(0, 5)
    : [];
  const useExisting = (v: { id: number; name: string }) => {
    if (!newVendorFor) return;
    addRow(newVendorFor, v);
    setNewVendorFor(null);
    setNewVendor({ name: "", kana: "" });
  };

  const canEdit = months.length > 0;

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
        <div className="relative">
          <h2 className="text-center text-lg font-bold tracking-[0.5em]">工事原価計算書</h2>
          {pathAllowed(role, "/scan") && (
            <Link
              href="/scan"
              className="absolute right-0 top-0 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <ScanLine className="w-3.5 h-3.5" />
              書類をスキャン
            </Link>
          )}
        </div>

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
                <td className={`${cell} text-slate-400`} colSpan={colCount - 1}>職人がまだいません（出面タブの「この現場の職人を選ぶ」から選びます）</td>
              </tr>
            ) : (
              laborLines.map(({ w, kind }, i) => {
                const byMonth = kind === "day" ? w.manDays : kind === "early" ? w.early : w.overtime;
                const total = kind === "day" ? w.manDaysTotal : kind === "early" ? w.earlyTotal : w.overtimeTotal;
                const rate = kind === "day" ? w.dayRate : kind === "early" ? w.earlyRate : w.overtimeRate;
                const field = kind === "day" ? "dayRate" : kind === "early" ? "earlyRate" : "overtimeRate";
                return (
                  <tr key={`${w.craftsmanId}-${kind}`} className={kind === "day" ? "" : "text-slate-500"}>
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
            {(() => { let rowNo = 0; return SECTIONS.map(({ key, label, budgetLabel }) => {
              const s = sections[key];
              const have = new Set(s.rows.map((r) => r.vendorId));
              const rows: VendorRow[] = [
                ...s.rows,
                ...added[key]
                  .filter((a) => !have.has(a.vendorId))
                  .map((a) => ({ vendorId: a.vendorId, name: a.name, byMonth: {}, provByMonth: {}, lockedMonths: [], total: 0, budget: null })),
              ];
              return (
                <Fragment key={key}>
                  {sectionHeader(label, "仕入先", "残高", budgetLabel, rows.length === 0 && !canEdit ? 3 : rows.length + 2 + (canEdit ? 1 : 0))}
                  {rows.length === 0 && !canEdit && (
                    <tr>
                      <td className={`${cell} ${stickL2} bg-white text-slate-300`}>—</td>
                      {monthCols.map((m) => <td key={m.key} className={cell} />)}
                      <td className={`${cell} ${stickR3} bg-white`} />
                      <td className={`${cell} ${stickR2} bg-white`} />
                      <td className={`${cell} ${stickR1} bg-white`} />
                    </tr>
                  )}
                  {rows.map((r) => { const ri = rowNo++; return (
                      <tr key={`${r.vendorId ?? r.name}`}>
                        <td className={`${cell} ${stickL2} bg-white whitespace-nowrap`} title={r.name}>{r.name}</td>
                        {monthCols.map((m) => (
                          r.vendorId != null && canEdit ? (
                            <td key={m.key} className={`${cell} px-0.5 py-0.5`}>
                              <CellInput
                                value={r.byMonth[m.key] ?? 0}
                                prov={r.provByMonth[m.key] ?? 0}
                                locked={r.lockedMonths.includes(m.key)}
                                pos={`${ri}:${monthCols.findIndex((x) => x.key === m.key)}`}
                                onSave={(v) => saveCell(key, r.vendorId!, m.key, v)}
                              />
                            </td>
                          ) : (
                            <td key={m.key} className={numCell}>{yen(r.byMonth[m.key] ?? 0)}</td>
                          )
                        ))}
                        <td className={`${numCell} ${stickR3} bg-white`}>{yen(r.total)}</td>
                        <td className={`${numCell} ${stickR2} bg-white ${r.budget != null && r.budget - r.total < 0 ? "text-destructive" : ""}`}>
                          {r.budget != null ? Math.round(r.budget - r.total).toLocaleString("ja-JP") : ""}
                        </td>
                        <td className={`${numCell} ${stickR1} bg-white`}>{yen(r.budget ?? r.total)}</td>
                      </tr>
                  ); })}
                  {canEdit && (
                    <tr>
                      <td className={`${cell} ${stickL2} bg-white py-0.5`}>
                        <Select
                          value=""
                          onValueChange={(id) => {
                            if (id === "__new__") {
                              // プルダウンが閉じて元のボタンに戻るのを待ってから窓を開く（でないと名前の欄に入力できない）
                              setTimeout(() => setNewVendorFor(key), 0);
                              return;
                            }
                            const v = data.vendors.find((x) => String(x.id) === id);
                            if (v) addRow(key, v);
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs border-dashed text-slate-500">
                            <SelectValue placeholder="＋ 仕入先を足す" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[320px]" searchPlaceholder="仕入先を探す">
                            <SelectItem value="__new__" className="text-primary font-medium">＋ 新しい仕入先を登録する</SelectItem>
                            {data.vendors.map((v) => (
                              <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={`${cell} text-xs text-slate-400`} colSpan={monthCols.length + 3}>
                        仕入先を選ぶと行が増えます。月のマスに金額を打つと、仮（請求書待ち）として入ります
                      </td>
                    </tr>
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
            }); })()}

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

        <Dialog open={newVendorFor != null} onOpenChange={(o) => { if (!o) setNewVendorFor(null); }}>
          <DialogContent
            className="max-w-sm"
            onOpenAutoFocus={(e) => { e.preventDefault(); vendorNameRef.current?.focus(); }}
          >
            <DialogHeader>
              <DialogTitle>新しい仕入先を登録</DialogTitle>
              <DialogDescription>名前だけで登録できます。振込先などは、あとで仕入先マスタで足してください。</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500">仕入先の名前（必須）</label>
                <Input
                  ref={vendorNameRef}
                  value={newVendor.name}
                  onChange={(e) => setNewVendor((v) => ({ ...v, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    if (sameVendor) useExisting(sameVendor);
                    else createVendor();
                  }}
                  placeholder="例：武重商会"
                />
                {sameVendor && (
                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    「{sameVendor.name}」はもう登録されています。新しく作らずに、登録済みの仕入先を使ってください。
                  </div>
                )}
                {similarVendors.length > 0 && (
                  <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
                    <p>似た名前の仕入先があります。同じ業者ならこちらを使ってください。</p>
                    {similarVendors.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => useExisting(v)}
                        className="block w-full text-left rounded px-2 py-1 bg-white border border-amber-200 hover:border-primary hover:text-primary"
                      >
                        {v.name} を使う
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-500">フリガナ（あれば）</label>
                <Input
                  value={newVendor.kana}
                  onChange={(e) => setNewVendor((v) => ({ ...v, kana: e.target.value }))}
                  placeholder="例：タケシゲショウカイ"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewVendorFor(null)}>やめる</Button>
              {sameVendor ? (
                <Button onClick={() => useExisting(sameVendor)}>登録済みの仕入先を使う</Button>
              ) : (
                <Button onClick={createVendor} disabled={!newVendor.name.trim() || creatingVendor}>
                  {creatingVendor && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  {similarVendors.length > 0 ? "別の業者なので新しく登録する" : "登録して行を足す"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 仮と請求書の照合（Excel で納品書の金額と請求書の金額を見比べていたのと同じ） */}
        <div>
          <h3 className="font-semibold text-slate-700 mb-2">仮と請求書の照合</h3>
          {data.matches.length === 0 ? (
            <p className="text-xs text-slate-400 border border-dashed border-slate-300 rounded px-3 py-3">
              まだありません。上のマスに金額を打つと「請求書待ち」としてここに並び、請求書をスキャンすると突き合わせます。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 border-l border-t border-slate-300">
                <thead>
                  <tr>
                    <th className={`${head} text-left`}>仕入先</th>
                    <th className={head}>月</th>
                    <th className={head}>仮（納品書）</th>
                    <th className={head}>請求書</th>
                    <th className={head}>差</th>
                    <th className={head}>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {data.matches.map((m) => {
                    const st = STATUS_LABEL[m.status];
                    return (
                      <tr key={`${m.vendorId}-${m.month}-${m.invoiceId ?? "w"}`} className={m.status === "review" ? "bg-amber-50/60" : ""}>
                        <td className={`${cell} whitespace-nowrap`}>{m.vendorName}</td>
                        <td className={`${cell} text-center whitespace-nowrap`}>
                          {monthJa(m.month)}
                          {m.invoiceMonth && m.invoiceMonth !== m.month && (
                            <span className="ml-1 text-[10px] text-slate-400">（請求書 {monthJa(m.invoiceMonth)}）</span>
                          )}
                        </td>
                        <td className={numCell}>{formatCurrency(m.provisional)}</td>
                        <td className={numCell}>{m.invoice != null ? formatCurrency(m.invoice) : "—"}</td>
                        <td className={`${numCell} ${m.difference ? "font-semibold text-destructive" : "text-slate-400"}`}>
                          {m.difference == null ? "—" : m.difference === 0 ? "0" : `${m.difference > 0 ? "+" : ""}${Math.round(m.difference).toLocaleString("ja-JP")}`}
                        </td>
                        <td className={`${cell} whitespace-nowrap`}>
                          <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${st.tone}`}>{st.label}</span>
                          {m.status === "review" && (
                            <button
                              type="button"
                              onClick={() => settle(m)}
                              className="ml-2 rounded border border-primary px-2 py-0.5 text-xs text-primary hover:bg-primary hover:text-white"
                            >
                              請求書の金額で確定
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400">
          業者からの原価は、請求書で確定した金額と、まだ請求書の来ていない仮（<span className="bg-amber-50 text-amber-800 px-1">黄色</span>）を足しています。
          請求書が来ると仮は請求書の金額に置きかわるので、二重には数えません。労務費は出面の人工×単価で、単価はその欄に直接入れられます。
        </p>
      </div>
    </div>
  );
}
