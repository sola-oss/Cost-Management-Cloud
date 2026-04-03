import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, ArrowLeft, Copy, Printer, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── 型定義 ──────────────────────────────────────────────────────────────────
interface EstimateItem {
  _key: string;
  rowIndex: number;
  level: 1 | 2 | 3 | 4 | 5;
  workType: string;
  itemName: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  amount: number;
  rowType: "normal" | "discount" | "total" | "tax" | "pagebreak";
  notes: string;
}

interface EstimateForm {
  projectId: string;
  estimateDate: string;
  createdDate: string;
  clientName: string;
  clientAddress: string;
  subject: string;
  location: string;
  constructionPeriod: string;
  validityPeriod: string;
  paymentTerms: string;
  taxRate: number;
  status: string;
  notes: string;
  architectFirm: string;
  companyName: string;
  companyAddress: string;
  companyTel: string;
  companyFax: string;
  companyStaff: string;
  department: string;
  memo: string;
}

interface Project { id: number; name: string; projectCode: string; clientName: string; location: string; }
interface WorkType { id: number; code: string; name: string; }
interface Client { id: number; clientCode: string; name: string; address: string | null; }

const LEVEL_LABELS: Record<number, string> = { 1: "大", 2: "中", 3: "小", 4: "細", 5: "商品" };
const ROW_TYPE_LABELS: Record<string, string> = {
  normal: "通常", discount: "値引", total: "合計", tax: "消費税", pagebreak: "改ページ",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "作成中", submitted: "提出済", approved: "承認済", lost: "失注",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  submitted: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  lost: "bg-red-100 text-red-600 border-red-200",
};

let _kc = 0;
function nk() { return `r${++_kc}`; }

// ─── API ─────────────────────────────────────────────────────────────────────
async function fetchProjects(): Promise<{ items: Project[] }> {
  const r = await fetch(`${BASE}/api/projects?limit=200`);
  return r.json();
}
async function fetchWorkTypes(): Promise<WorkType[]> {
  const r = await fetch(`${BASE}/api/work-types`);
  return r.json();
}
async function fetchClients(): Promise<{ items: Client[] }> {
  const r = await fetch(`${BASE}/api/clients`);
  if (!r.ok) return { items: [] };
  return r.json();
}
async function fetchEstimate(id: number) {
  const r = await fetch(`${BASE}/api/estimates/${id}`);
  if (!r.ok) throw new Error("not found");
  return r.json();
}
async function apiPost(url: string, body: any) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("api error");
  return r.json();
}
async function apiPatch(url: string, body: any) {
  const r = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("api error");
  return r.json();
}

function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// ─── 補助コンポーネント ───────────────────────────────────────────────────────
function FieldRow({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex border-b border-slate-300 last:border-b-0 ${className}`}>
      <div className="bg-slate-100 border-r border-slate-300 px-2 py-1 text-xs text-slate-600 font-medium w-24 shrink-0 flex items-center">
        {label}
      </div>
      <div className="flex-1 px-2 py-0.5 flex items-center">
        {children}
      </div>
    </div>
  );
}

function FormInput({
  value, onChange, placeholder = "", className = "", type = "text",
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-transparent border-0 outline-none focus:bg-orange-50 focus:ring-1 focus:ring-orange-300 rounded px-1 py-0.5 text-sm placeholder:text-slate-300 transition-colors ${className}`}
    />
  );
}

// ─── メインエディター ─────────────────────────────────────────────────────────
export default function EstimateEditor({ id }: { id?: number }) {
  const isNew = !id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("cover");
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState<EstimateForm>({
    projectId: "", estimateDate: today, createdDate: today,
    clientName: "", clientAddress: "", subject: "", location: "",
    constructionPeriod: "", validityPeriod: addMonths(today, 1),
    paymentTerms: "別途契約書通り", taxRate: 10, status: "draft", notes: "",
    architectFirm: "", companyName: "", companyAddress: "",
    companyTel: "", companyFax: "", companyStaff: "", department: "", memo: "",
  });

  const sf = (patch: Partial<EstimateForm>) => setForm((f) => ({ ...f, ...patch }));

  const [cpStart, setCpStart] = useState("");
  const [cpEnd, setCpEnd] = useState("");
  const [vpMode, setVpMode] = useState<"1m" | "2m" | "3m" | "custom">("1m");

  const [items, setItems] = useState<EstimateItem[]>([
    { _key: nk(), rowIndex: 0, level: 1, workType: "", itemName: "", quantity: null, unit: "式", unitPrice: null, amount: 0, rowType: "normal", notes: "" },
  ]);

  const { data: projectsData } = useQuery({ queryKey: ["projects-list"], queryFn: fetchProjects });
  const { data: workTypes } = useQuery({ queryKey: ["work-types"], queryFn: fetchWorkTypes });
  const { data: clientsData } = useQuery({ queryKey: ["clients-list"], queryFn: fetchClients });
  const clients = clientsData?.items ?? [];
  const { data: existing } = useQuery({
    queryKey: ["estimate", id],
    queryFn: () => fetchEstimate(id!),
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    if (!existing) return;
    const cp = existing.constructionPeriod ?? "";
    const cpParts = cp.split("〜");
    if (cpParts.length === 2) {
      setCpStart(cpParts[0] || "");
      setCpEnd(cpParts[1] || "");
    } else {
      setCpStart("");
      setCpEnd("");
    }
    const vp = existing.validityPeriod ?? "";
    const estDate = existing.estimateDate ?? today;
    if (/^\d{4}-\d{2}-\d{2}$/.test(vp)) {
      const m1 = addMonths(estDate, 1);
      const m2 = addMonths(estDate, 2);
      const m3 = addMonths(estDate, 3);
      if (vp === m1) setVpMode("1m");
      else if (vp === m2) setVpMode("2m");
      else if (vp === m3) setVpMode("3m");
      else setVpMode("custom");
    } else {
      setVpMode("1m");
    }
    setForm({
      projectId: existing.projectId ? String(existing.projectId) : "",
      estimateDate: existing.estimateDate ?? today,
      createdDate: existing.createdDate ?? today,
      clientName: existing.clientName ?? "",
      clientAddress: existing.clientAddress ?? "",
      subject: existing.subject ?? "",
      location: existing.location ?? "",
      constructionPeriod: existing.constructionPeriod ?? "",
      validityPeriod: /^\d{4}-\d{2}-\d{2}$/.test(vp) ? vp : addMonths(estDate, 1),
      paymentTerms: existing.paymentTerms ?? "別途契約書通り",
      taxRate: existing.taxRate ?? 10,
      status: existing.status ?? "draft",
      notes: existing.notes ?? "",
      architectFirm: existing.architectFirm ?? "",
      companyName: existing.companyName ?? "",
      companyAddress: existing.companyAddress ?? "",
      companyTel: existing.companyTel ?? "",
      companyFax: existing.companyFax ?? "",
      companyStaff: existing.companyStaff ?? "",
      department: existing.department ?? "",
      memo: existing.memo ?? "",
    });
    if (existing.items?.length > 0) {
      setItems(existing.items.map((it: any, idx: number) => ({
        _key: nk(), rowIndex: it.rowIndex ?? idx, level: it.level ?? 1,
        workType: it.workType ?? "", itemName: it.itemName ?? "",
        quantity: it.quantity, unit: it.unit ?? "",
        unitPrice: it.unitPrice, amount: it.amount ?? 0,
        rowType: it.rowType ?? "normal", notes: it.notes ?? "",
      })));
    }
  }, [existing]);

  // 工事選択時に得意先・場所を自動引用
  const handleProjectChange = (pid: string) => {
    const proj = projectsData?.items?.find((p) => String(p.id) === pid);
    setForm((f) => ({
      ...f,
      projectId: pid,
      clientName: proj ? proj.clientName : f.clientName,
      location: proj ? (proj.location ?? f.location) : f.location,
    }));
  };

  // ─── 集計 ────────────────────────────────────────────────────────────────
  const taxExcluded = items
    .filter((i) => i.rowType === "normal" || i.rowType === "discount")
    .reduce((s, i) => {
      const a = i.quantity != null && i.unitPrice != null
        ? Math.round(i.quantity * i.unitPrice)
        : i.amount;
      return i.rowType === "discount" ? s - Math.abs(a) : s + a;
    }, 0);
  const taxAmount = Math.round(taxExcluded * form.taxRate / 100);
  const taxIncluded = taxExcluded + taxAmount;
  const fmt = (n: number) => `¥${n.toLocaleString()}`;
  const fmtDate = (d: string) => {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${y}年${parseInt(m)}月${parseInt(day)}日`;
  };

  // ─── 明細操作 ─────────────────────────────────────────────────────────────
  function addRow(afterIdx?: number) {
    const r: EstimateItem = {
      _key: nk(), rowIndex: 0, level: 1, workType: "", itemName: "",
      quantity: null, unit: "式", unitPrice: null, amount: 0, rowType: "normal", notes: "",
    };
    setItems((prev) => {
      const n = [...prev];
      n.splice(afterIdx !== undefined ? afterIdx + 1 : n.length, 0, r);
      return n.map((x, i) => ({ ...x, rowIndex: i }));
    });
  }

  function removeRow(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key).map((x, i) => ({ ...x, rowIndex: i })));
  }

  function updateRow(key: string, patch: Partial<EstimateItem>) {
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i;
      const u = { ...i, ...patch };
      if (u.rowType === "normal" && u.quantity != null && u.unitPrice != null) {
        u.amount = Math.round(u.quantity * u.unitPrice);
      }
      return u;
    }));
  }

  function copyRowAbove(idx: number) {
    if (idx === 0) return;
    const above = items[idx - 1];
    setItems((prev) => prev.map((it, i) => i === idx ? { ...above, _key: it._key, rowIndex: idx } : it));
  }

  // ─── 保存 ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      const body = {
        ...form,
        projectId: form.projectId || null,
        taxExcludedAmount: taxExcluded,
        taxAmount,
        taxIncludedAmount: taxIncluded,
      };
      const itemsPayload = items.map(({ _key, ...rest }) => rest);

      let estId: number;
      if (isNew) {
        const est = await apiPost(`${BASE}/api/estimates`, body);
        estId = est.id;
        await apiPost(`${BASE}/api/estimates/${estId}/items`, { items: itemsPayload });
        toast({ title: "登録しました", description: `${est.estimateNumber} を作成しました。` });
        qc.invalidateQueries({ queryKey: ["estimates"] });
        navigate(`/estimates/${estId}`);
      } else {
        await apiPatch(`${BASE}/api/estimates/${id}`, body);
        await apiPost(`${BASE}/api/estimates/${id}/items`, { items: itemsPayload });
        qc.invalidateQueries({ queryKey: ["estimates"] });
        qc.invalidateQueries({ queryKey: ["estimate", id] });
        toast({ title: "保存しました" });
      }
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    if (!id) return;
    try {
      const r = await fetch(`${BASE}/api/estimates/${id}/duplicate`, { method: "POST" });
      const est = await r.json();
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast({ title: "複写しました", description: `${est.estimateNumber} を作成しました。` });
      navigate(`/estimates/${est.id}`);
    } catch {
      toast({ title: "エラー", variant: "destructive" });
    }
  }

  const estNumber = existing?.estimateNumber ?? "（新規）";

  return (
    <div className="flex flex-col min-h-screen bg-slate-100">
      {/* ナビバー */}
      <div className="sticky top-0 z-20 bg-white border-b shadow-sm print:hidden">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate("/estimates")} className="p-2 rounded hover:bg-slate-100">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 flex items-center gap-2">
            <span className="font-semibold text-slate-700">見積書</span>
            <span className="text-slate-300">|</span>
            <span className="font-mono text-sm text-slate-500">{estNumber}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLOR[form.status]}`}>
              {STATUS_LABELS[form.status]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <>
                <Button variant="outline" size="sm" onClick={handleDuplicate} className="gap-1.5 text-xs">
                  <Copy className="w-3.5 h-3.5" />複写
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 text-xs">
                  <Printer className="w-3.5 h-3.5" />PDFで出力
                </Button>
              </>
            )}
            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5 text-xs"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "保存中…" : "保存する"}
            </Button>
          </div>
        </div>
      </div>

      {/* 金額サマリー */}
      <div className="max-w-5xl mx-auto w-full px-4 pt-4 print:hidden">
        <div className="bg-white rounded-xl border shadow-sm px-6 py-3 flex gap-8 items-center">
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-0.5">税抜金額</div>
            <div className="text-base font-bold text-slate-700">{fmt(taxExcluded)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-slate-500 mb-0.5">消費税（{form.taxRate}%）</div>
            <div className="text-base font-bold text-slate-700">{fmt(taxAmount)}</div>
          </div>
          <div className="text-center border-l pl-8">
            <div className="text-xs text-slate-500 mb-0.5">見積金額（税込）</div>
            <div className="text-2xl font-extrabold text-orange-600">{fmt(taxIncluded)}</div>
          </div>
        </div>
      </div>

      {/* タブ */}
      <div className="max-w-5xl mx-auto w-full px-4 py-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 bg-white border print:hidden">
            <TabsTrigger value="cover" className="text-sm">表紙</TabsTrigger>
            <TabsTrigger value="items" className="text-sm">明細</TabsTrigger>
          </TabsList>

          {/* ──── 表紙タブ ─────────────────────────────────────────────────── */}
          <TabsContent value="cover">
            {/* 見積書用紙風コンテナ */}
            <div className="bg-white shadow-md border border-slate-300 rounded-lg overflow-hidden print:shadow-none print:rounded-none">

              {/* ① ヘッダー行 */}
              <div className="grid grid-cols-3 border-b border-slate-300 items-center px-4 py-3 gap-2">
                {/* 左：見積番号 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 whitespace-nowrap">見積番号</span>
                  <span className="font-mono text-sm font-semibold text-slate-700 border-b border-slate-400 px-1 min-w-[140px]">
                    {estNumber}
                  </span>
                </div>
                {/* 中央：御見積書 */}
                <div className="text-center">
                  <h1 className="text-3xl font-bold tracking-widest text-slate-800">御見積書</h1>
                </div>
                {/* 右：見積日 */}
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-xs text-slate-500 whitespace-nowrap">見積日</span>
                  <input
                    type="date"
                    value={form.estimateDate}
                    onChange={(e) => sf({ estimateDate: e.target.value })}
                    className="text-sm border-b border-slate-400 bg-transparent focus:outline-none focus:border-orange-400 px-1 py-0.5"
                  />
                </div>
              </div>

              {/* ② 得意先エリア（左）＋ ③ 金額サマリー（右） */}
              <div className="grid grid-cols-2 border-b border-slate-300">
                {/* 得意先エリア */}
                <div className="border-r border-slate-300 p-4 space-y-2">
                  {clients.length > 0 && (
                    <Select
                      value={clients.find((c) => c.name === form.clientName)?.clientCode ?? "__manual__"}
                      onValueChange={(val) => {
                        if (val === "__manual__") return;
                        const found = clients.find((c) => c.clientCode === val);
                        if (found) {
                          sf({
                            clientName: found.name,
                            clientAddress: found.address ?? form.clientAddress,
                          });
                        }
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs border-slate-300 mb-1">
                        <SelectValue placeholder="得意先マスタから選択" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__manual__" className="text-xs text-slate-400">— 直接入力 —</SelectItem>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.clientCode} className="text-xs">
                            <span className="font-mono text-slate-500 mr-1">{c.clientCode}</span>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="flex items-baseline gap-2">
                    <input
                      value={form.clientName}
                      onChange={(e) => sf({ clientName: e.target.value })}
                      placeholder="得意先名"
                      className="text-2xl font-bold text-slate-800 border-b-2 border-slate-400 bg-transparent focus:outline-none focus:border-orange-400 w-full placeholder:text-slate-300"
                    />
                    <span className="text-lg font-medium text-slate-700 whitespace-nowrap">御中</span>
                  </div>
                  <FormInput
                    value={form.clientAddress}
                    onChange={(v) => sf({ clientAddress: v })}
                    placeholder="住所"
                  />
                  <Textarea
                    value={form.notes}
                    onChange={(e) => sf({ notes: e.target.value })}
                    placeholder="下記の通り御見積申し上げます。"
                    rows={2}
                    className="text-sm border-0 bg-transparent focus:ring-0 resize-none p-0 placeholder:text-slate-300"
                  />
                </div>

                {/* 金額サマリー表 */}
                <div className="p-4">
                  <div className="border border-slate-300">
                    <div className="grid grid-cols-2 border-b border-slate-300">
                      <div className="bg-slate-100 border-r border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 text-center">合計金額</div>
                      <div className="px-3 py-2 text-right font-bold text-slate-800 text-lg">{fmt(taxIncluded)}</div>
                    </div>
                    <div className="grid grid-cols-2 border-b border-slate-300">
                      <div className="bg-slate-100 border-r border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 text-center">工事代金</div>
                      <div className="px-3 py-2 text-right font-medium text-slate-700">{fmt(taxExcluded)}</div>
                    </div>
                    <div className="grid grid-cols-2">
                      <div className="bg-slate-100 border-r border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 text-center">消費税</div>
                      <div className="px-3 py-2 text-right text-slate-600">
                        <span>{fmt(taxAmount)}</span>
                        <span className="text-xs text-slate-400 ml-1">({form.taxRate}%)</span>
                      </div>
                    </div>
                  </div>
                  {/* 消費税率選択 */}
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-slate-500">消費税率</span>
                    <Select value={String(form.taxRate)} onValueChange={(v) => sf({ taxRate: parseFloat(v) })}>
                      <SelectTrigger className="h-7 text-xs w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10%</SelectItem>
                        <SelectItem value="8">8%</SelectItem>
                        <SelectItem value="0">非課税</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* ④ 工事情報グリッド */}
              <div className="grid grid-cols-2 border-b border-slate-300">
                {/* 左：工事詳細 */}
                <div className="border-r border-slate-300 border-collapse">
                  <FieldRow label="件名">
                    <FormInput value={form.subject} onChange={(v) => sf({ subject: v })} placeholder="例：〇〇邸 新築工事" />
                  </FieldRow>
                  <FieldRow label="場所">
                    <FormInput value={form.location} onChange={(v) => sf({ location: v })} placeholder="例：宮城県仙台市青葉区1-2-1" />
                  </FieldRow>
                  <FieldRow label="工期">
                    <div className="flex items-center gap-1 w-full">
                      <input
                        type="date"
                        value={cpStart}
                        onChange={(e) => {
                          const s = e.target.value;
                          setCpStart(s);
                          sf({ constructionPeriod: s || cpEnd ? `${s}〜${cpEnd}` : "" });
                        }}
                        className="bg-transparent border-0 outline-none focus:bg-orange-50 focus:ring-1 focus:ring-orange-300 rounded px-1 py-0.5 text-sm flex-1 min-w-0"
                      />
                      <span className="text-slate-400 text-xs shrink-0">〜</span>
                      <input
                        type="date"
                        value={cpEnd}
                        onChange={(e) => {
                          const e2 = e.target.value;
                          setCpEnd(e2);
                          sf({ constructionPeriod: cpStart || e2 ? `${cpStart}〜${e2}` : "" });
                        }}
                        className="bg-transparent border-0 outline-none focus:bg-orange-50 focus:ring-1 focus:ring-orange-300 rounded px-1 py-0.5 text-sm flex-1 min-w-0"
                      />
                    </div>
                  </FieldRow>
                  <FieldRow label="支払条件">
                    <FormInput value={form.paymentTerms} onChange={(v) => sf({ paymentTerms: v })} />
                  </FieldRow>
                  <FieldRow label="有効期限">
                    <div className="flex items-center gap-1.5 w-full">
                      <select
                        value={vpMode}
                        onChange={(e) => {
                          const m = e.target.value as typeof vpMode;
                          setVpMode(m);
                          if (m !== "custom") {
                            const months = m === "1m" ? 1 : m === "2m" ? 2 : 3;
                            sf({ validityPeriod: addMonths(form.estimateDate, months) });
                          }
                        }}
                        className="bg-transparent border-0 outline-none focus:bg-orange-50 focus:ring-1 focus:ring-orange-300 rounded px-1 py-0.5 text-xs text-slate-700 shrink-0 cursor-pointer"
                      >
                        <option value="1m">見積日より1ヶ月後</option>
                        <option value="2m">見積日より2ヶ月後</option>
                        <option value="3m">見積日より3ヶ月後</option>
                        <option value="custom">直接入力</option>
                      </select>
                      <input
                        type="date"
                        value={form.validityPeriod}
                        onChange={(e) => {
                          setVpMode("custom");
                          sf({ validityPeriod: e.target.value });
                        }}
                        className="bg-transparent border-0 outline-none focus:bg-orange-50 focus:ring-1 focus:ring-orange-300 rounded px-1 py-0.5 text-sm flex-1 min-w-0"
                      />
                    </div>
                  </FieldRow>
                  <FieldRow label="社内メモ" className="border-b-0">
                    <FormInput value={form.memo} onChange={(v) => sf({ memo: v })} placeholder="（印刷されません）" />
                  </FieldRow>
                </div>

                {/* 右：自社情報 */}
                <div>
                  <FieldRow label="建築士事務所">
                    <FormInput value={form.architectFirm} onChange={(v) => sf({ architectFirm: v })} placeholder="例：一級建築士事務所" />
                  </FieldRow>
                  <FieldRow label="会社名">
                    <FormInput value={form.companyName} onChange={(v) => sf({ companyName: v })} placeholder="例：レッツ建設株式会社" />
                  </FieldRow>
                  <FieldRow label="住所">
                    <FormInput value={form.companyAddress} onChange={(v) => sf({ companyAddress: v })} placeholder="例：宮城県仙台市本町一丁目3-5" />
                  </FieldRow>
                  <FieldRow label="TEL">
                    <FormInput value={form.companyTel} onChange={(v) => sf({ companyTel: v })} placeholder="022-224-XXXX" />
                  </FieldRow>
                  <FieldRow label="FAX">
                    <FormInput value={form.companyFax} onChange={(v) => sf({ companyFax: v })} placeholder="022-224-XXXX" />
                  </FieldRow>
                  <FieldRow label="" className="border-b-0">
                    <span className="text-xs text-slate-400">（追記欄）</span>
                  </FieldRow>
                </div>
              </div>

              {/* ⑤ フッター行 */}
              <div className="grid grid-cols-2 gap-0">
                {/* 左：作成日・担当・部門 */}
                <div className="border-r border-slate-300">
                  <FieldRow label="作成日">
                    <input
                      type="date"
                      value={form.createdDate}
                      onChange={(e) => sf({ createdDate: e.target.value })}
                      className="text-sm bg-transparent border-0 focus:outline-none focus:bg-orange-50 focus:ring-1 focus:ring-orange-300 rounded px-1 py-0.5"
                    />
                  </FieldRow>
                  <FieldRow label="担当者">
                    <FormInput value={form.companyStaff} onChange={(v) => sf({ companyStaff: v })} placeholder="担当者名" />
                  </FieldRow>
                  <FieldRow label="部門" className="border-b-0">
                    <FormInput value={form.department} onChange={(v) => sf({ department: v })} placeholder="例：本社建築一課" />
                  </FieldRow>
                </div>

                {/* 右：関連工事・ステータス */}
                <div>
                  <FieldRow label="関連工事">
                    <Select value={form.projectId || "none"} onValueChange={(v) => handleProjectChange(v === "none" ? "" : v)}>
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 w-full">
                        <SelectValue placeholder="未設定" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">未設定</SelectItem>
                        {projectsData?.items?.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.projectCode} {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label="ステータス">
                    <Select value={form.status} onValueChange={(v) => sf({ status: v })}>
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">作成中</SelectItem>
                        <SelectItem value="submitted">提出済</SelectItem>
                        <SelectItem value="approved">承認済</SelectItem>
                        <SelectItem value="lost">失注</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <div className="h-[37px]" />
                </div>
              </div>
            </div>

            {/* 保存ボタン */}
            <div className="mt-4 flex justify-end print:hidden">
              <Button
                className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="w-4 h-4" />
                {saving ? "保存中…" : "保存する"}
              </Button>
            </div>
          </TabsContent>

          {/* ──── 明細タブ ──────────────────────────────────────────────── */}
          <TabsContent value="items">
            <div className="bg-white shadow-md border border-slate-300 rounded-lg overflow-hidden">
              <div className="bg-teal-700 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-semibold">明細入力</span>
                <span className="text-xs text-teal-200">各セルをクリックして編集</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-300 text-slate-500">
                      <th className="text-center px-2 py-2 w-8 border-r border-slate-200">No</th>
                      <th className="text-center px-2 py-2 w-16 border-r border-slate-200">階層</th>
                      <th className="text-left px-2 py-2 w-28 border-r border-slate-200">工種</th>
                      <th className="text-left px-2 py-2 border-r border-slate-200">品名・摘要</th>
                      <th className="text-right px-2 py-2 w-20 border-r border-slate-200">数量</th>
                      <th className="text-center px-2 py-2 w-14 border-r border-slate-200">単位</th>
                      <th className="text-right px-2 py-2 w-24 border-r border-slate-200">単価</th>
                      <th className="text-right px-2 py-2 w-28 border-r border-slate-200">見積金額</th>
                      <th className="text-center px-2 py-2 w-20 border-r border-slate-200">種別</th>
                      <th className="px-2 py-2 w-20 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const isSpecial = item.rowType !== "normal";
                      const isPagebreak = item.rowType === "pagebreak";
                      const amt = !isSpecial && item.quantity != null && item.unitPrice != null
                        ? Math.round(item.quantity * item.unitPrice)
                        : item.amount;
                      const indent = (item.level - 1) * 12;
                      const rowBg = item.rowType === "total" ? "bg-teal-50" :
                        item.rowType === "tax" ? "bg-amber-50" :
                        item.rowType === "discount" ? "bg-red-50" :
                        item.rowType === "pagebreak" ? "bg-slate-100" : "";

                      if (isPagebreak) {
                        return (
                          <tr key={item._key} className="border-b border-dashed border-slate-300 bg-slate-50">
                            <td className="px-2 py-1 text-center text-slate-400">{idx + 1}</td>
                            <td colSpan={7} className="px-3 py-1 text-center text-slate-400 text-xs italic">
                              ── 改ページ ──
                            </td>
                            <td className="px-2 py-1 text-center">
                              <span className="text-xs text-slate-400">改ページ</span>
                            </td>
                            <td className="px-2 py-1">
                              <div className="flex items-center gap-0.5 justify-center">
                                <button onClick={() => addRow(idx)} className="p-1 rounded hover:bg-orange-100 text-orange-500">
                                  <Plus className="w-3 h-3" />
                                </button>
                                <button onClick={() => removeRow(item._key)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={item._key} className={`border-b border-slate-200 hover:bg-orange-50 transition-colors ${rowBg}`}>
                          <td className="px-2 py-1 text-center text-slate-400 border-r border-slate-100">{idx + 1}</td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <Select
                              value={String(item.level)}
                              onValueChange={(v) => updateRow(item._key, { level: parseInt(v) as any })}
                            >
                              <SelectTrigger className="h-6 text-xs w-14 px-1 border-slate-200">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[1, 2, 3, 4, 5].map((l) => (
                                  <SelectItem key={l} value={String(l)}>{LEVEL_LABELS[l]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            {!isSpecial && (
                              <>
                                <input
                                  value={item.workType}
                                  onChange={(e) => updateRow(item._key, { workType: e.target.value })}
                                  list={`wt-${item._key}`}
                                  placeholder="工種"
                                  className="w-full bg-transparent focus:bg-orange-50 border-0 text-xs px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-300 rounded"
                                />
                                <datalist id={`wt-${item._key}`}>
                                  {workTypes?.map((wt) => <option key={wt.id} value={wt.name} />)}
                                </datalist>
                              </>
                            )}
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <div style={{ paddingLeft: `${indent}px` }}>
                              <input
                                value={item.itemName}
                                onChange={(e) => updateRow(item._key, { itemName: e.target.value })}
                                placeholder={isSpecial ? ROW_TYPE_LABELS[item.rowType] : "品名・摘要"}
                                className={`w-full bg-transparent focus:bg-orange-50 border-0 text-xs px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-300 rounded ${item.rowType === "total" ? "font-bold" : ""}`}
                              />
                            </div>
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            {!isSpecial && (
                              <input
                                type="number"
                                value={item.quantity ?? ""}
                                onChange={(e) => updateRow(item._key, { quantity: e.target.value === "" ? null : parseFloat(e.target.value) })}
                                className="w-full bg-transparent focus:bg-orange-50 border-0 text-xs px-1 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-orange-300 rounded"
                              />
                            )}
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            {!isSpecial && (
                              <input
                                value={item.unit}
                                onChange={(e) => updateRow(item._key, { unit: e.target.value })}
                                list="unit-list"
                                className="w-full bg-transparent focus:bg-orange-50 border-0 text-xs px-1 py-0.5 text-center focus:outline-none focus:ring-1 focus:ring-orange-300 rounded"
                              />
                            )}
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            {!isSpecial && (
                              <input
                                type="number"
                                value={item.unitPrice ?? ""}
                                onChange={(e) => updateRow(item._key, { unitPrice: e.target.value === "" ? null : parseFloat(e.target.value) })}
                                className="w-full bg-transparent focus:bg-orange-50 border-0 text-xs px-1 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-orange-300 rounded"
                              />
                            )}
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            {isSpecial && item.rowType !== "pagebreak" ? (
                              <input
                                type="number"
                                value={item.amount}
                                onChange={(e) => updateRow(item._key, { amount: parseFloat(e.target.value) || 0 })}
                                className={`w-full bg-transparent focus:bg-orange-50 border-0 text-xs px-1 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-orange-300 rounded ${item.rowType === "total" ? "font-bold text-teal-700" : ""}`}
                              />
                            ) : (
                              <div className={`text-right pr-1 text-xs ${item.rowType === "total" ? "font-bold text-teal-700" : "font-medium text-slate-700"}`}>
                                {amt > 0 || (item.quantity != null && item.unitPrice != null) ? `¥${amt.toLocaleString()}` : "—"}
                              </div>
                            )}
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <Select
                              value={item.rowType}
                              onValueChange={(v) => updateRow(item._key, { rowType: v as EstimateItem["rowType"] })}
                            >
                              <SelectTrigger className="h-6 text-xs w-18 px-1 border-slate-200">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(ROW_TYPE_LABELS).map(([k, v]) => (
                                  <SelectItem key={k} value={k}>{v}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-1 py-1">
                            <div className="flex items-center gap-0.5 justify-center">
                              <button
                                onClick={() => copyRowAbove(idx)}
                                disabled={idx === 0}
                                className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 text-slate-500 text-xs"
                                title="上の行を複写"
                              >↑</button>
                              <button
                                onClick={() => addRow(idx)}
                                className="p-1 rounded hover:bg-orange-100 text-orange-500"
                                title="この行の下に追加"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => removeRow(item._key)}
                                className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <datalist id="unit-list">
                  {["式", "m", "m²", "m³", "本", "枚", "個", "箱", "kg", "t", "台", "ヶ所", "日"].map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </div>

              {/* フッター */}
              <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={() => addRow()} className="gap-1.5 text-xs">
                  <Plus className="w-3.5 h-3.5" />行を追加
                </Button>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <span className="text-xs text-slate-500 mr-2">税抜合計</span>
                    <span className="font-semibold text-slate-700">{fmt(taxExcluded)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 mr-2">消費税（{form.taxRate}%）</span>
                    <span className="font-semibold text-slate-700">{fmt(taxAmount)}</span>
                  </div>
                  <div className="text-right border-l pl-6">
                    <span className="text-xs text-slate-500 mr-2">見積金額</span>
                    <span className="text-lg font-bold text-orange-600">{fmt(taxIncluded)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-2" onClick={handleSave} disabled={saving}>
                <Save className="w-4 h-4" />
                {saving ? "保存中…" : "保存する"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
