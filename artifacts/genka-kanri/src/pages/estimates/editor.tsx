import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, ArrowLeft, Copy, Printer, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  representativeName: string;
  constructionLicense: string;
  staffMobile: string;
  staffEmail: string;
  miscExpensesRate: number;
  discountAmount: number;
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

// ─── 印刷用レイアウト ─────────────────────────────────────────────────────────
function PrintLayout({
  form,
  items,
  estNumber,
  taxAmount,
  taxIncluded,
  miscExpensesAmount,
  discountAmount,
  finalSubtotal,
}: {
  form: EstimateForm;
  items: EstimateItem[];
  estNumber: string;
  taxAmount: number;
  taxIncluded: number;
  miscExpensesAmount: number;
  discountAmount: number;
  finalSubtotal: number;
}) {
  const fmt = (n: number) => `¥${n.toLocaleString()}`;
  const fmtDate = (d: string) => {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${y}年${parseInt(m)}月${parseInt(day)}日`;
  };
  const fmtDateSlash = (d: string) => {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${y}/${m.padStart(2, "0")}/${day.padStart(2, "0")}`;
  };
  const pageHeader = (
    <div className="flex justify-between text-[9px] text-slate-500 mb-3 pb-1 border-b border-slate-300">
      <span>見積番号: {estNumber}</span>
      <span>発行日: {fmtDate(form.estimateDate)}</span>
    </div>
  );

  // 工種ごとにグループ化
  // - pagebreak/total/tax行は除外
  // - workTypeの前後空白・連続空白を正規化してグループキーとして使用
  // - 全workTypeが空の場合は「（未分類）」として1グループにまとめる
  // - items配列の順序通りに出現順でグループを構築し、groups.mapで全グループを明細ページに出力
  type Group = { name: string; rows: EstimateItem[]; subtotal: number };
  const groups: Group[] = [];
  const groupMap = new Map<string, Group>();
  for (const item of items) {
    if (item.rowType === "pagebreak" || item.rowType === "total" || item.rowType === "tax") continue;
    const wt = (item.workType ?? "").replace(/\s+/g, " ").trim() || "（未分類）";
    if (!groupMap.has(wt)) {
      const g: Group = { name: wt, rows: [], subtotal: 0 };
      groupMap.set(wt, g);
      groups.push(g);
    }
    const g = groupMap.get(wt)!;
    const amt = item.quantity != null && item.unitPrice != null
      ? Math.round(item.quantity * item.unitPrice)
      : (item.amount ?? 0);
    g.rows.push(item);
    g.subtotal += item.rowType === "discount" ? -Math.abs(amt) : amt;
  }
  const itemsSubtotal = groups.reduce((s, g) => s + g.subtotal, 0);

  return (
    <div className="hidden print:block text-black font-sans text-[11px]">
      <style>{`@media print { @page { margin: 0 !important; } }`}</style>

      {/* ===== PAGE 1: 御見積書（表紙） ===== */}
      <div className="print-page w-[210mm] p-[15mm] box-border break-after-page">
        {/* ヘッダー：見積番号（左）・発行日（右） */}
        <div className="flex justify-between text-[10px] text-slate-500 mb-4">
          <span>見積番号: {estNumber}</span>
          <span>発行日: {fmtDateSlash(form.estimateDate)}</span>
        </div>

        {/* タイトル */}
        <div className="text-center mb-5">
          <h1 className="text-3xl font-bold tracking-widest text-slate-900">御　見　積　書</h1>
        </div>

        {/* 得意先名（名前部分に底線、右端に御中） */}
        <div className="flex items-end mb-2">
          <span className="text-xl font-bold flex-1 border-b-2 border-black pb-1">
            {form.clientName || "\u3000\u3000\u3000\u3000\u3000\u3000\u3000\u3000"}
          </span>
          <span className="text-base font-bold ml-4 pb-1">御中</span>
        </div>
        <div className="text-xs mb-5">下記の通り、御見積申し上げます。</div>

        {/* 御見積金額エリア */}
        <div className="flex items-center mb-1">
          <span className="text-sm font-medium w-28 shrink-0">御見積金額</span>
          <span className="text-xl font-extrabold text-slate-900 border border-black px-5 py-1 leading-tight">
            {fmt(taxIncluded)}
          </span>
        </div>
        <div className="flex gap-10 text-xs text-slate-600 mb-6 pl-28">
          <span>税抜合計　{fmt(finalSubtotal)}-</span>
          <span>消費税（{form.taxRate}%）　{fmt(taxAmount)}-</span>
        </div>

        {/* 2カラム：工事情報（左）・自社情報（右） */}
        <div className="flex gap-6">
          {/* 左：工事情報（底線のみのフォームスタイル） */}
          <div className="flex-1 text-xs">
            {[
              { label: "工事名",   value: form.subject },
              { label: "工事場所", value: form.location },
              { label: "工事期間", value: form.constructionPeriod },
              { label: "有効期限", value: fmtDate(form.validityPeriod) },
              { label: "備考",     value: form.notes },
            ].map(({ label, value }) => (
              <div key={label} className="flex border-b border-slate-400 py-2 min-h-[28px]">
                <span className="font-medium w-16 shrink-0">{label}</span>
                <span className="flex-1 pl-2">{value}</span>
              </div>
            ))}
          </div>

          {/* 右：自社情報（プレーンテキスト） */}
          <div className="w-52 shrink-0 text-[10px] self-start leading-relaxed">
            <img src={`${BASE}/otsuka-logo.png`} alt="会社ロゴ" className="w-40 mb-2" />
            {form.companyName && <div className="font-bold mb-0.5">{form.companyName}</div>}
            {form.representativeName && <div>代表取締役　{form.representativeName}</div>}
            {form.companyAddress && <div>{form.companyAddress}</div>}
            {form.companyTel && <div>TEL：{form.companyTel}</div>}
            {form.companyFax && <div>FAX：{form.companyFax}</div>}
            {form.constructionLicense && <div className="mt-1">建設業許可 {form.constructionLicense}</div>}
            {form.companyStaff && <div className="mt-1">担当者：{form.companyStaff}</div>}
            {form.staffMobile && <div>携帯番号：{form.staffMobile}</div>}
            {form.staffEmail && <div>MAIL：{form.staffEmail}</div>}
          </div>
        </div>
      </div>

      {/* ===== PAGE 2: 見積内訳書 ===== */}
      <div className="print-page w-[210mm] p-[15mm] box-border break-after-page">
        {pageHeader}
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold tracking-wider">見　積　内　訳　書</h2>
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-400 px-2 py-2 text-center w-10">No.</th>
              <th className="border border-slate-400 px-3 py-2 text-left">分類</th>
              <th className="border border-slate-400 px-3 py-2 text-right w-40">見積額</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => (
              <tr key={i}>
                <td className="border border-slate-400 px-2 py-1.5 text-center">{i + 1}</td>
                <td className="border border-slate-400 px-3 py-1.5">{g.name}</td>
                <td className="border border-slate-400 px-3 py-1.5 text-right">{g.subtotal.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="bg-slate-50">
              <td colSpan={2} className="border border-slate-400 px-3 py-1.5 text-right font-medium">小計</td>
              <td className="border border-slate-400 px-3 py-1.5 text-right font-medium">{itemsSubtotal.toLocaleString()}</td>
            </tr>
            {miscExpensesAmount > 0 && (
              <tr>
                <td colSpan={2} className="border border-slate-400 px-3 py-1.5 text-right">諸経費</td>
                <td className="border border-slate-400 px-3 py-1.5 text-right">{miscExpensesAmount.toLocaleString()}</td>
              </tr>
            )}
            {discountAmount > 0 && (
              <tr>
                <td colSpan={2} className="border border-slate-400 px-3 py-1.5 text-right">お値引き</td>
                <td className="border border-slate-400 px-3 py-1.5 text-right">-{discountAmount.toLocaleString()}</td>
              </tr>
            )}
            <tr className="bg-slate-100 font-bold">
              <td colSpan={2} className="border border-slate-400 px-3 py-2 text-right">税抜合計</td>
              <td className="border border-slate-400 px-3 py-2 text-right">{finalSubtotal.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ===== PAGE 3+: 見積明細書（工種ごと1ページ） ===== */}
      {groups.map((group, gi) => (
        <div key={gi} className={`print-page w-[210mm] p-[15mm] box-border${gi < groups.length - 1 ? " break-after-page" : ""}`}>
          {pageHeader}
          <div className="text-center mb-3">
            <h2 className="text-xl font-bold tracking-wider">見　積　明　細　書</h2>
            <div className="text-xs text-slate-600 mt-0.5">（{gi + 1}. {group.name}）</div>
          </div>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-400 px-1 py-1.5 text-center w-8">No.</th>
                <th className="border border-slate-400 px-2 py-1.5 text-left">摘要</th>
                <th className="border border-slate-400 px-2 py-1.5 text-left w-28">備考</th>
                <th className="border border-slate-400 px-1 py-1.5 text-center w-20">数量・単位</th>
                <th className="border border-slate-400 px-2 py-1.5 text-right w-20">見積単価</th>
                <th className="border border-slate-400 px-2 py-1.5 text-right w-24">見積額</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((item, idx) => {
                const amt = item.quantity != null && item.unitPrice != null
                  ? Math.round(item.quantity * item.unitPrice)
                  : (item.amount ?? 0);
                const isDiscount = item.rowType === "discount";
                return (
                  <tr key={item._key} className={idx % 2 === 1 ? "bg-slate-50" : ""}>
                    <td className="border border-slate-300 px-1 py-1 text-center text-slate-500">{idx + 1}</td>
                    <td className="border border-slate-300 px-2 py-1">{item.itemName}</td>
                    <td className="border border-slate-300 px-2 py-1 text-slate-600">{item.notes}</td>
                    <td className="border border-slate-300 px-1 py-1 text-center">
                      {item.quantity != null ? `${item.quantity.toLocaleString()}${item.unit}` : item.unit}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-right">
                      {item.unitPrice != null ? item.unitPrice.toLocaleString() : ""}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-right">
                      {isDiscount ? `-${Math.abs(amt).toLocaleString()}` : amt > 0 ? amt.toLocaleString() : ""}
                    </td>
                  </tr>
                );
              })}
              <tr className="font-bold">
                <td colSpan={5} className="border border-slate-400 px-2 py-1.5 text-right">
                  {group.name}　小計
                </td>
                <td className="border border-slate-400 px-2 py-1.5 text-right">
                  {group.subtotal.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── メインエディター ─────────────────────────────────────────────────────────
export default function EstimateEditor({ id }: { id?: number }) {
  const isNew = !id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState<EstimateForm>({
    projectId: "", estimateDate: today, createdDate: today,
    clientName: "", clientAddress: "", subject: "", location: "",
    constructionPeriod: "", validityPeriod: addMonths(today, 1),
    paymentTerms: "別途契約書通り", taxRate: 10, status: "draft", notes: "",
    architectFirm: "", companyName: "", companyAddress: "",
    companyTel: "", companyFax: "", companyStaff: "", department: "", memo: "",
    representativeName: "", constructionLicense: "", staffMobile: "", staffEmail: "",
    miscExpensesRate: 0, discountAmount: 0,
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
  const { data: companySettings } = useQuery({
    queryKey: ["company-settings"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/company-settings`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!isNew || !companySettings) return;
    sf({
      companyName: companySettings.companyName ?? "",
      companyAddress: [companySettings.postalCode ? `〒${companySettings.postalCode}` : "", companySettings.address ?? ""].filter(Boolean).join(" "),
      companyTel: companySettings.tel ?? "",
      companyFax: companySettings.fax ?? "",
      representativeName: companySettings.representativeName ?? "",
      constructionLicense: companySettings.constructionLicense ?? "",
      companyStaff: companySettings.staffName ?? "",
      staffMobile: companySettings.staffMobile ?? "",
      staffEmail: companySettings.staffEmail ?? "",
    });
  }, [isNew, companySettings]);

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
      representativeName: existing.representativeName ?? "",
      constructionLicense: existing.constructionLicense ?? "",
      staffMobile: existing.staffMobile ?? "",
      staffEmail: existing.staffEmail ?? "",
      miscExpensesRate: existing.miscExpensesRate ?? 0,
      discountAmount: existing.discountAmount ?? 0,
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
  const itemsSubtotal = items
    .filter((i) => i.rowType === "normal" || i.rowType === "discount")
    .reduce((s, i) => {
      const a = i.quantity != null && i.unitPrice != null
        ? Math.round(i.quantity * i.unitPrice)
        : i.amount;
      return i.rowType === "discount" ? s - Math.abs(a) : s + a;
    }, 0);
  const miscExpensesAmount = form.miscExpensesRate > 0
    ? Math.round(itemsSubtotal * form.miscExpensesRate / 100)
    : 0;
  const finalSubtotal = itemsSubtotal + miscExpensesAmount - form.discountAmount;
  const taxAmount = Math.round(finalSubtotal * form.taxRate / 100);
  const taxIncluded = finalSubtotal + taxAmount;

  const fmtMoney = (n: number) => `¥${n.toLocaleString()}`;

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
        taxExcludedAmount: finalSubtotal,
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
    <div className="p-6 max-w-5xl mx-auto">
      {/* 印刷専用レイアウト（print:block） */}
      <PrintLayout
        form={form}
        items={items}
        estNumber={estNumber}
        taxAmount={taxAmount}
        taxIncluded={taxIncluded}
        miscExpensesAmount={miscExpensesAmount}
        discountAmount={form.discountAmount}
        finalSubtotal={finalSubtotal}
      />

      {/* ─── ヘッダー ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigate("/estimates")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              {isNew ? "新規見積書" : estNumber}
            </h1>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLOR[form.status]}`}>
            {STATUS_LABELS[form.status]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <>
              <Button variant="outline" size="sm" onClick={handleDuplicate} className="gap-1.5">
                <Copy className="w-3.5 h-3.5" />複写
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => window.open(`${BASE}/estimates/${id}/print`, "_blank")}
              >
                <Printer className="w-3.5 h-3.5" />印刷
              </Button>
            </>
          )}
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? "保存中…" : isNew ? "作成する" : "更新する"}
          </Button>
        </div>
      </div>

      <div className="space-y-6 print:hidden">
        {/* ─── 基本情報 ──────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2 mb-4">基本情報</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>見積日</Label>
              <Input
                type="date"
                value={form.estimateDate}
                onChange={(e) => sf({ estimateDate: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>作成日</Label>
              <Input
                type="date"
                value={form.createdDate}
                onChange={(e) => sf({ createdDate: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <Label>得意先</Label>
              {clients.length > 0 ? (
                <Select
                  value={clients.find((c) => c.name === form.clientName)?.clientCode ?? "__manual__"}
                  onValueChange={(val) => {
                    if (val === "__manual__") return;
                    const found = clients.find((c) => c.clientCode === val);
                    if (found) {
                      sf({ clientName: found.name, clientAddress: found.address ?? form.clientAddress });
                    }
                  }}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="得意先を選択..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual__">— 直接入力 —</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.clientCode}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.clientName}
                  onChange={(e) => sf({ clientName: e.target.value })}
                  placeholder="得意先名"
                  className="mt-1"
                />
              )}
            </div>
            <div>
              <Label>得意先名（直接入力）</Label>
              <Input
                value={form.clientName}
                onChange={(e) => sf({ clientName: e.target.value })}
                placeholder="得意先名"
                className="mt-1"
              />
            </div>
          </div>

          <div className="mt-4">
            <Label>得意先住所</Label>
            <Input
              value={form.clientAddress}
              onChange={(e) => sf({ clientAddress: e.target.value })}
              placeholder="住所"
              className="mt-1"
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <Label>関連工事</Label>
              <Select value={form.projectId || "none"} onValueChange={(v) => handleProjectChange(v === "none" ? "" : v)}>
                <SelectTrigger className="mt-1">
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
            </div>
            <div>
              <Label>工事名</Label>
              <Input
                value={form.subject}
                onChange={(e) => sf({ subject: e.target.value })}
                placeholder="例：〇〇邸 新築工事"
                className="mt-1"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <Label>工事場所</Label>
              <Input
                value={form.location}
                onChange={(e) => sf({ location: e.target.value })}
                placeholder="例：宮城県仙台市"
                className="mt-1"
              />
            </div>
            <div>
              <Label>工事期間</Label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="date"
                  value={cpStart}
                  onChange={(e) => {
                    const s = e.target.value;
                    setCpStart(s);
                    sf({ constructionPeriod: s || cpEnd ? `${s}〜${cpEnd}` : "" });
                  }}
                  className="flex-1"
                />
                <span className="text-slate-400 text-xs shrink-0">〜</span>
                <Input
                  type="date"
                  value={cpEnd}
                  onChange={(e) => {
                    const e2 = e.target.value;
                    setCpEnd(e2);
                    sf({ constructionPeriod: cpStart || e2 ? `${cpStart}〜${e2}` : "" });
                  }}
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <Label>有効期限</Label>
              <div className="mt-1 flex items-center gap-2">
                <Select
                  value={vpMode}
                  onValueChange={(m) => {
                    setVpMode(m as typeof vpMode);
                    if (m !== "custom") {
                      const months = m === "1m" ? 1 : m === "2m" ? 2 : 3;
                      sf({ validityPeriod: addMonths(form.estimateDate, months) });
                    }
                  }}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1m">1ヶ月後</SelectItem>
                    <SelectItem value="2m">2ヶ月後</SelectItem>
                    <SelectItem value="3m">3ヶ月後</SelectItem>
                    <SelectItem value="custom">直接入力</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={form.validityPeriod}
                  onChange={(e) => { setVpMode("custom"); sf({ validityPeriod: e.target.value }); }}
                  className="flex-1"
                />
              </div>
            </div>
            <div>
              <Label>支払条件</Label>
              <Input
                value={form.paymentTerms}
                onChange={(e) => sf({ paymentTerms: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <Label>ステータス</Label>
              <Select value={form.status} onValueChange={(v) => sf({ status: v })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">作成中</SelectItem>
                  <SelectItem value="submitted">提出済</SelectItem>
                  <SelectItem value="approved">承認済</SelectItem>
                  <SelectItem value="lost">失注</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>建築士事務所</Label>
              <Input
                value={form.architectFirm}
                onChange={(e) => sf({ architectFirm: e.target.value })}
                placeholder="例：一級建築士事務所"
                className="mt-1"
              />
            </div>
          </div>
        </section>

        {/* ─── 自社情報 ──────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2 mb-4">自社情報</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>会社名</Label>
              <Input
                value={form.companyName}
                onChange={(e) => sf({ companyName: e.target.value })}
                placeholder="例：レッツ建設株式会社"
                className="mt-1"
              />
            </div>
            <div>
              <Label>代表者</Label>
              <Input
                value={form.representativeName}
                onChange={(e) => sf({ representativeName: e.target.value })}
                placeholder="例：山田 太郎"
                className="mt-1"
              />
            </div>
          </div>
          <div className="mt-4">
            <Label>住所</Label>
            <Input
              value={form.companyAddress}
              onChange={(e) => sf({ companyAddress: e.target.value })}
              placeholder="例：宮城県仙台市本町一丁目3-5"
              className="mt-1"
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <Label>TEL</Label>
              <Input
                value={form.companyTel}
                onChange={(e) => sf({ companyTel: e.target.value })}
                placeholder="022-224-XXXX"
                className="mt-1"
              />
            </div>
            <div>
              <Label>FAX</Label>
              <Input
                value={form.companyFax}
                onChange={(e) => sf({ companyFax: e.target.value })}
                placeholder="022-224-XXXX"
                className="mt-1"
              />
            </div>
          </div>
          <div className="mt-4">
            <Label>建設業許可番号</Label>
            <Input
              value={form.constructionLicense}
              onChange={(e) => sf({ constructionLicense: e.target.value })}
              placeholder="例：宮城県知事許可（般-XX）第XXXX号"
              className="mt-1"
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <Label>担当者</Label>
              <Input
                value={form.companyStaff}
                onChange={(e) => sf({ companyStaff: e.target.value })}
                placeholder="担当者名"
                className="mt-1"
              />
            </div>
            <div>
              <Label>携帯</Label>
              <Input
                value={form.staffMobile}
                onChange={(e) => sf({ staffMobile: e.target.value })}
                placeholder="090-XXXX-XXXX"
                className="mt-1"
              />
            </div>
          </div>
          <div className="mt-4">
            <Label>メール</Label>
            <Input
              value={form.staffEmail}
              onChange={(e) => sf({ staffEmail: e.target.value })}
              placeholder="example@company.co.jp"
              className="mt-1"
            />
          </div>
        </section>

        {/* ─── 明細 ──────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2 mb-4">明細</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-8 text-center">No</TableHead>
                  <TableHead className="w-28">工種</TableHead>
                  <TableHead className="min-w-[160px]">摘要</TableHead>
                  <TableHead className="w-36">備考（型番・仕様）</TableHead>
                  <TableHead className="w-20 text-right">数量</TableHead>
                  <TableHead className="w-16 text-center">単位</TableHead>
                  <TableHead className="w-28 text-right">単価</TableHead>
                  <TableHead className="w-28 text-right">金額</TableHead>
                  <TableHead className="w-20">種別</TableHead>
                  <TableHead className="w-20 text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => {
                  const isSpecial = item.rowType !== "normal";
                  const isPagebreak = item.rowType === "pagebreak";
                  const amt = !isSpecial && item.quantity != null && item.unitPrice != null
                    ? Math.round(item.quantity * item.unitPrice)
                    : item.amount;
                  const rowBg = item.rowType === "total" ? "bg-teal-50" :
                    item.rowType === "tax" ? "bg-amber-50" :
                    item.rowType === "discount" ? "bg-red-50" :
                    item.rowType === "pagebreak" ? "bg-slate-50" : "";

                  if (isPagebreak) {
                    return (
                      <TableRow key={item._key} className={rowBg}>
                        <TableCell className="text-center text-slate-400 text-xs">{idx + 1}</TableCell>
                        <TableCell colSpan={7} className="text-center text-slate-400 text-xs italic">
                          ── 改ページ ──
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-xs text-slate-400">改ページ</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-0.5 justify-center">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-500" onClick={() => addRow(idx)}>
                              <Plus className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={() => removeRow(item._key)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return (
                    <TableRow key={item._key} className={rowBg}>
                      <TableCell className="text-center text-slate-400 text-xs">{idx + 1}</TableCell>
                      <TableCell>
                        {!isSpecial && (
                          <>
                            <input
                              value={item.workType}
                              onChange={(e) => updateRow(item._key, { workType: e.target.value })}
                              list={`wt-${item._key}`}
                              placeholder="工種"
                              className="w-full h-8 border border-input bg-background rounded-md px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <datalist id={`wt-${item._key}`}>
                              {workTypes?.map((wt) => <option key={wt.id} value={wt.name} />)}
                            </datalist>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <input
                          value={item.itemName}
                          onChange={(e) => updateRow(item._key, { itemName: e.target.value })}
                          placeholder={isSpecial ? ROW_TYPE_LABELS[item.rowType] : "摘要"}
                          className={`w-full h-8 border border-input bg-background rounded-md px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring ${item.rowType === "total" ? "font-bold" : ""}`}
                        />
                      </TableCell>
                      <TableCell>
                        {!isSpecial && (
                          <input
                            value={item.notes}
                            onChange={(e) => updateRow(item._key, { notes: e.target.value })}
                            placeholder="型番・仕様など"
                            className="w-full h-8 border border-input bg-background rounded-md px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {!isSpecial && (
                          <input
                            type="number"
                            value={item.quantity ?? ""}
                            onChange={(e) => updateRow(item._key, { quantity: e.target.value === "" ? null : parseFloat(e.target.value) })}
                            className="w-full h-8 border border-input bg-background rounded-md px-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {!isSpecial && (
                          <input
                            value={item.unit}
                            onChange={(e) => updateRow(item._key, { unit: e.target.value })}
                            list="unit-list"
                            className="w-full h-8 border border-input bg-background rounded-md px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {!isSpecial && (
                          <input
                            type="number"
                            value={item.unitPrice ?? ""}
                            onChange={(e) => updateRow(item._key, { unitPrice: e.target.value === "" ? null : parseFloat(e.target.value) })}
                            className="w-full h-8 border border-input bg-background rounded-md px-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isSpecial && item.rowType !== "pagebreak" ? (
                          <input
                            type="number"
                            value={item.amount}
                            onChange={(e) => updateRow(item._key, { amount: parseFloat(e.target.value) || 0 })}
                            className={`w-full h-8 border border-input bg-background rounded-md px-2 text-xs text-right focus:outline-none focus:ring-1 focus:ring-ring ${item.rowType === "total" ? "font-bold text-teal-700" : ""}`}
                          />
                        ) : (
                          <span className={`text-xs font-medium ${item.rowType === "total" ? "text-teal-700 font-bold" : "text-slate-700"}`}>
                            {amt > 0 || (item.quantity != null && item.unitPrice != null) ? fmtMoney(amt) : "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.rowType}
                          onValueChange={(v) => updateRow(item._key, { rowType: v as EstimateItem["rowType"] })}
                        >
                          <SelectTrigger className="h-8 text-xs px-2">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ROW_TYPE_LABELS).map(([k, v]) => (
                              <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5 justify-center">
                          <button
                            onClick={() => copyRowAbove(idx)}
                            disabled={idx === 0}
                            className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 text-slate-500 text-xs"
                            title="上の行を複写"
                          >↑</button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-orange-500 hover:text-orange-600"
                            onClick={() => addRow(idx)}
                            title="この行の下に追加"
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-red-500"
                            onClick={() => removeRow(item._key)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <datalist id="unit-list">
              {["式", "m", "m²", "m³", "本", "枚", "個", "箱", "kg", "t", "台", "ヶ所", "日"].map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => addRow()}>
            <Plus className="w-3.5 h-3.5" />行を追加
          </Button>

          {/* 調整項目と合計サマリー */}
          <div className="mt-6 border-t pt-4">
            <div className="grid grid-cols-2 gap-6">
              {/* 調整項目 */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-slate-700">調整項目</h3>
                <div className="flex items-center gap-3">
                  <Label className="w-28 text-sm shrink-0">諸経費率（%）</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={form.miscExpensesRate || ""}
                      onChange={(e) => sf({ miscExpensesRate: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                      min="0"
                      max="100"
                      step="0.1"
                      className="w-24 text-right h-8"
                    />
                    <span className="text-xs text-slate-500">%</span>
                    {miscExpensesAmount > 0 && (
                      <span className="text-xs text-slate-600">= {fmtMoney(miscExpensesAmount)}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="w-28 text-sm shrink-0">お値引き（円）</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">▲</span>
                    <Input
                      type="number"
                      value={form.discountAmount || ""}
                      onChange={(e) => sf({ discountAmount: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                      min="0"
                      className="w-32 text-right h-8"
                    />
                    <span className="text-xs text-slate-500">円</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="w-28 text-sm shrink-0">消費税率</Label>
                  <Select value={String(form.taxRate)} onValueChange={(v) => sf({ taxRate: parseFloat(v) })}>
                    <SelectTrigger className="h-8 w-24">
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

              {/* 合計サマリー */}
              <div className="space-y-2 max-w-sm ml-auto">
                <div className="flex justify-between text-sm text-slate-600">
                  <span>明細合計</span>
                  <span>{fmtMoney(itemsSubtotal)}</span>
                </div>
                {miscExpensesAmount > 0 && (
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>諸経費（{form.miscExpensesRate}%）</span>
                    <span>{fmtMoney(miscExpensesAmount)}</span>
                  </div>
                )}
                {form.discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>お値引き</span>
                    <span>▲{fmtMoney(form.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-slate-600 border-t pt-2">
                  <span>税抜合計</span>
                  <span>{fmtMoney(finalSubtotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-600">
                  <span>消費税（{form.taxRate}%）</span>
                  <span>{fmtMoney(taxAmount)}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-slate-800 border-t pt-2">
                  <span>御見積金額（税込）</span>
                  <span className="text-orange-600">{fmtMoney(taxIncluded)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 備考・社内メモ ─────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border p-6">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2 mb-4">備考・メモ</h2>
          <div className="space-y-4">
            <div>
              <Label>備考（印刷対象）</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => sf({ notes: e.target.value })}
                rows={3}
                placeholder="備考・特記事項など（見積書に印刷されます）"
                className="mt-1"
              />
            </div>
            <div>
              <Label>社内メモ（非印刷）</Label>
              <Textarea
                value={form.memo}
                onChange={(e) => sf({ memo: e.target.value })}
                rows={2}
                placeholder="社内用メモ（印刷されません）"
                className="mt-1"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
