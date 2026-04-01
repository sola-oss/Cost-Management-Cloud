import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Save, ArrowLeft, Copy, FileDown, Plus, Trash2, ChevronDown, ChevronRight, Printer
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── 型定義 ──────────────────────────────────────────────────────────────────
interface EstimateItem {
  _key: string;
  rowIndex: number;
  level: 1 | 2 | 3;
  workType: string;
  itemName: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  amount: number;
  rowType: "normal" | "subtotal" | "total" | "tax" | "discount";
  notes: string;
}

interface EstimateForm {
  projectId: string;
  estimateDate: string;
  clientName: string;
  clientAddress: string;
  subject: string;
  constructionPeriod: string;
  validityPeriod: string;
  paymentTerms: string;
  taxRate: number;
  status: string;
  notes: string;
  companyName: string;
  companyAddress: string;
  companyTel: string;
  companyStaff: string;
  memo: string;
  manualAmount: boolean;
  manualTaxExcluded: number;
}

interface Project { id: number; name: string; projectCode: string; clientName: string; }
interface WorkType { id: number; code: string; name: string; }

const ROW_TYPE_LABELS = {
  normal: "通常",
  subtotal: "小計",
  total: "合計",
  tax: "消費税",
  discount: "値引",
};

let _keyCounter = 0;
function newKey() { return `r${++_keyCounter}`; }

function calcAmount(item: EstimateItem): number {
  if (item.rowType !== "normal") return item.amount;
  if (item.quantity == null || item.unitPrice == null) return item.amount;
  return Math.round(item.quantity * item.unitPrice);
}

async function fetchProjects(): Promise<{ items: Project[] }> {
  const res = await fetch(`${BASE}/api/projects?limit=200`);
  if (!res.ok) throw new Error("fetch error");
  return res.json();
}

async function fetchWorkTypes(): Promise<WorkType[]> {
  const res = await fetch(`${BASE}/api/work-types`);
  if (!res.ok) throw new Error("fetch error");
  return res.json();
}

async function fetchEstimate(id: number) {
  const res = await fetch(`${BASE}/api/estimates/${id}`);
  if (!res.ok) throw new Error("fetch error");
  return res.json();
}

async function createEstimate(body: any) {
  const res = await fetch(`${BASE}/api/estimates`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("create error");
  return res.json();
}

async function updateEstimate(id: number, body: any) {
  const res = await fetch(`${BASE}/api/estimates/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("update error");
  return res.json();
}

async function saveItems(id: number, items: Omit<EstimateItem, "_key">[]) {
  const res = await fetch(`${BASE}/api/estimates/${id}/items`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error("items error");
  return res.json();
}

async function duplicateEstimate(id: number) {
  const res = await fetch(`${BASE}/api/estimates/${id}/duplicate`, { method: "POST" });
  if (!res.ok) throw new Error("dup error");
  return res.json();
}

// ─── PDF 出力 ─────────────────────────────────────────────────────────────────
function printEstimate() {
  window.print();
}

// ─── エディター本体 ───────────────────────────────────────────────────────────
interface Props { id?: number; }

export default function EstimateEditor({ id }: Props) {
  const isNew = !id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("cover");
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState<EstimateForm>({
    projectId: "",
    estimateDate: today,
    clientName: "",
    clientAddress: "",
    subject: "",
    constructionPeriod: "",
    validityPeriod: "見積日より1ヶ月",
    paymentTerms: "別途契約書通り",
    taxRate: 10,
    status: "draft",
    notes: "",
    companyName: "",
    companyAddress: "",
    companyTel: "",
    companyStaff: "",
    memo: "",
    manualAmount: false,
    manualTaxExcluded: 0,
  });

  const [items, setItems] = useState<EstimateItem[]>([
    { _key: newKey(), rowIndex: 0, level: 1, workType: "", itemName: "", quantity: null, unit: "式", unitPrice: null, amount: 0, rowType: "normal", notes: "" },
  ]);

  const { data: projectsData } = useQuery({ queryKey: ["projects-list"], queryFn: fetchProjects });
  const { data: workTypes } = useQuery({ queryKey: ["work-types"], queryFn: fetchWorkTypes });

  const { data: existingData } = useQuery({
    queryKey: ["estimate", id],
    queryFn: () => fetchEstimate(id!),
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    if (!existingData) return;
    setForm({
      projectId: existingData.projectId ? String(existingData.projectId) : "",
      estimateDate: existingData.estimateDate ?? today,
      clientName: existingData.clientName ?? "",
      clientAddress: existingData.clientAddress ?? "",
      subject: existingData.subject ?? "",
      constructionPeriod: existingData.constructionPeriod ?? "",
      validityPeriod: existingData.validityPeriod ?? "見積日より1ヶ月",
      paymentTerms: existingData.paymentTerms ?? "別途契約書通り",
      taxRate: existingData.taxRate ?? 10,
      status: existingData.status ?? "draft",
      notes: existingData.notes ?? "",
      companyName: existingData.companyName ?? "",
      companyAddress: existingData.companyAddress ?? "",
      companyTel: existingData.companyTel ?? "",
      companyStaff: existingData.companyStaff ?? "",
      memo: existingData.memo ?? "",
      manualAmount: false,
      manualTaxExcluded: existingData.taxExcludedAmount ?? 0,
    });
    if (existingData.items && existingData.items.length > 0) {
      setItems(existingData.items.map((it: any, idx: number) => ({
        _key: newKey(),
        rowIndex: it.rowIndex ?? idx,
        level: it.level ?? 1,
        workType: it.workType ?? "",
        itemName: it.itemName ?? "",
        quantity: it.quantity,
        unit: it.unit ?? "",
        unitPrice: it.unitPrice,
        amount: it.amount ?? 0,
        rowType: it.rowType ?? "normal",
        notes: it.notes ?? "",
      })));
    }
  }, [existingData]);

  // 工事選択時に得意先を自動引用
  const handleProjectChange = (pid: string) => {
    const proj = projectsData?.items?.find((p) => String(p.id) === pid);
    setForm((f) => ({
      ...f,
      projectId: pid,
      clientName: proj ? proj.clientName : f.clientName,
    }));
  };

  // ─── 集計計算 ──────────────────────────────────────────────────────────────
  const taxExcludedAuto = items
    .filter((i) => i.rowType === "normal" || i.rowType === "discount")
    .reduce((s, i) => {
      const a = calcAmount(i);
      return i.rowType === "discount" ? s - Math.abs(a) : s + a;
    }, 0);

  const taxExcluded = form.manualAmount ? form.manualTaxExcluded : taxExcludedAuto;
  const taxAmount = Math.round(taxExcluded * form.taxRate / 100);
  const taxIncluded = taxExcluded + taxAmount;

  const fmt = (n: number) => `¥${n.toLocaleString()}`;

  // ─── 明細操作 ──────────────────────────────────────────────────────────────
  function addRow(afterIdx?: number) {
    const newRow: EstimateItem = {
      _key: newKey(), rowIndex: 0, level: 1, workType: "", itemName: "",
      quantity: null, unit: "式", unitPrice: null, amount: 0, rowType: "normal", notes: "",
    };
    setItems((prev) => {
      const next = [...prev];
      const pos = afterIdx !== undefined ? afterIdx + 1 : next.length;
      next.splice(pos, 0, newRow);
      return next.map((it, idx) => ({ ...it, rowIndex: idx }));
    });
  }

  function removeRow(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key).map((it, idx) => ({ ...it, rowIndex: idx })));
  }

  function updateRow(key: string, patch: Partial<EstimateItem>) {
    setItems((prev) =>
      prev.map((i) => {
        if (i._key !== key) return i;
        const updated = { ...i, ...patch };
        if (updated.rowType === "normal" && updated.quantity != null && updated.unitPrice != null) {
          updated.amount = Math.round(updated.quantity * updated.unitPrice);
        }
        return updated;
      })
    );
  }

  function copyRowAbove(idx: number) {
    if (idx === 0) return;
    const above = items[idx - 1];
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...above, _key: next[idx]._key, rowIndex: idx };
      return next;
    });
  }

  // ─── 保存 ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      const body = {
        projectId: form.projectId ? parseInt(form.projectId) : null,
        estimateDate: form.estimateDate,
        clientName: form.clientName,
        clientAddress: form.clientAddress,
        subject: form.subject,
        constructionPeriod: form.constructionPeriod,
        validityPeriod: form.validityPeriod,
        paymentTerms: form.paymentTerms,
        taxRate: form.taxRate,
        taxExcludedAmount: taxExcluded,
        taxAmount,
        taxIncludedAmount: taxIncluded,
        status: form.status,
        notes: form.notes,
        companyName: form.companyName,
        companyAddress: form.companyAddress,
        companyTel: form.companyTel,
        companyStaff: form.companyStaff,
        memo: form.memo,
      };

      let estId: number;
      if (isNew) {
        const est = await createEstimate(body);
        estId = est.id;
        await saveItems(estId, items.map(({ _key, ...rest }) => rest));
        toast({ title: "登録しました", description: `${est.estimateNumber} を作成しました。` });
        qc.invalidateQueries({ queryKey: ["estimates"] });
        navigate(`/estimates/${estId}`);
      } else {
        await updateEstimate(id!, body);
        await saveItems(id!, items.map(({ _key, ...rest }) => rest));
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
      const est = await duplicateEstimate(id);
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast({ title: "複写しました", description: `${est.estimateNumber} を作成しました。` });
      navigate(`/estimates/${est.id}`);
    } catch {
      toast({ title: "エラー", variant: "destructive" });
    }
  }

  const estNumber = existingData?.estimateNumber ?? "（新規）";
  const statusLabel: Record<string, string> = { draft: "作成中", submitted: "提出済", approved: "承認済", lost: "失注" };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* ナビバー */}
      <div className="sticky top-0 z-20 bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate("/estimates")} className="p-2 rounded hover:bg-slate-100">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 flex items-center gap-3">
            <span className="font-semibold text-slate-700">見積書</span>
            <span className="text-slate-300">|</span>
            <span className="font-mono text-sm text-slate-500">{estNumber}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
              form.status === "draft" ? "bg-slate-100 text-slate-600 border-slate-200" :
              form.status === "submitted" ? "bg-blue-100 text-blue-700 border-blue-200" :
              form.status === "approved" ? "bg-green-100 text-green-700 border-green-200" :
              "bg-red-100 text-red-600 border-red-200"
            }`}>{statusLabel[form.status] ?? form.status}</span>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <>
                <Button variant="outline" size="sm" onClick={handleDuplicate} className="gap-1.5 text-xs">
                  <Copy className="w-3.5 h-3.5" />複写
                </Button>
                <Button variant="outline" size="sm" onClick={printEstimate} className="gap-1.5 text-xs">
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

      {/* コンテンツ */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {/* 金額サマリー */}
        <div className="flex gap-4 mb-6 flex-wrap">
          <div className="bg-white rounded-xl border shadow-sm px-6 py-4 flex gap-8">
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1">税抜金額</div>
              <div className="text-lg font-bold text-slate-700">{fmt(taxExcluded)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1">消費税（{form.taxRate}%）</div>
              <div className="text-lg font-bold text-slate-700">{fmt(taxAmount)}</div>
            </div>
            <div className="text-center border-l pl-8">
              <div className="text-xs text-slate-500 mb-1">見積金額（税込）</div>
              <div className="text-2xl font-extrabold text-orange-600">{fmt(taxIncluded)}</div>
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 bg-white border">
            <TabsTrigger value="cover" className="text-sm">表紙</TabsTrigger>
            <TabsTrigger value="items" className="text-sm">明細</TabsTrigger>
          </TabsList>

          {/* ──── 表紙タブ ──────────────────────────────────────────────── */}
          <TabsContent value="cover" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 基本情報 */}
              <Card>
                <CardHeader className="bg-teal-700 text-white rounded-t-lg py-3 px-4">
                  <CardTitle className="text-sm font-semibold">基本情報</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block text-slate-600">見積日 <span className="text-red-500">*</span></Label>
                      <Input
                        type="date"
                        value={form.estimateDate}
                        onChange={(e) => setForm((f) => ({ ...f, estimateDate: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block text-slate-600">ステータス</Label>
                      <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                        <SelectTrigger className="h-8 text-sm">
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
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block text-slate-600">関連工事</Label>
                    <Select value={form.projectId || "none"} onValueChange={(v) => handleProjectChange(v === "none" ? "" : v)}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="工事を選択（任意）" />
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
                    <Label className="text-xs mb-1 block text-slate-600">件名 <span className="text-red-500">*</span></Label>
                    <Input
                      value={form.subject}
                      onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                      placeholder="例：〇〇邸 新築工事"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block text-slate-600">工期</Label>
                      <Input
                        value={form.constructionPeriod}
                        onChange={(e) => setForm((f) => ({ ...f, constructionPeriod: e.target.value }))}
                        placeholder="例：6月1日〜10月31日"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block text-slate-600">有効期限</Label>
                      <Input
                        value={form.validityPeriod}
                        onChange={(e) => setForm((f) => ({ ...f, validityPeriod: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block text-slate-600">支払条件</Label>
                      <Input
                        value={form.paymentTerms}
                        onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block text-slate-600">消費税率</Label>
                      <Select
                        value={String(form.taxRate)}
                        onValueChange={(v) => setForm((f) => ({ ...f, taxRate: parseFloat(v) }))}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10%</SelectItem>
                          <SelectItem value="8">8%（軽減）</SelectItem>
                          <SelectItem value="0">非課税</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 得意先情報 */}
              <Card>
                <CardHeader className="bg-teal-700 text-white rounded-t-lg py-3 px-4">
                  <CardTitle className="text-sm font-semibold">得意先情報</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <Label className="text-xs mb-1 block text-slate-600">得意先名 <span className="text-red-500">*</span></Label>
                    <Input
                      value={form.clientName}
                      onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                      placeholder="例：エステート住建"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block text-slate-600">住所</Label>
                    <Input
                      value={form.clientAddress}
                      onChange={(e) => setForm((f) => ({ ...f, clientAddress: e.target.value }))}
                      placeholder="例：宮城県仙台市青葉区1-2-1"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block text-slate-600">備考</Label>
                    <Textarea
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder="下記の通り御見積申し上げます。"
                      rows={3}
                      className="text-sm resize-none"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* 自社情報 */}
              <Card>
                <CardHeader className="bg-teal-700 text-white rounded-t-lg py-3 px-4">
                  <CardTitle className="text-sm font-semibold">自社情報</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <Label className="text-xs mb-1 block text-slate-600">会社名</Label>
                    <Input
                      value={form.companyName}
                      onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                      placeholder="例：レッツ建設株式会社"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block text-slate-600">住所</Label>
                    <Input
                      value={form.companyAddress}
                      onChange={(e) => setForm((f) => ({ ...f, companyAddress: e.target.value }))}
                      placeholder="例：宮城県仙台市本町一丁目3-5"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block text-slate-600">TEL</Label>
                      <Input
                        value={form.companyTel}
                        onChange={(e) => setForm((f) => ({ ...f, companyTel: e.target.value }))}
                        placeholder="022-224-XXXX"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block text-slate-600">担当者</Label>
                      <Input
                        value={form.companyStaff}
                        onChange={(e) => setForm((f) => ({ ...f, companyStaff: e.target.value }))}
                        placeholder="例：相沢 一太"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* メモ */}
              <Card>
                <CardHeader className="bg-teal-700 text-white rounded-t-lg py-3 px-4">
                  <CardTitle className="text-sm font-semibold">社内メモ</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <Textarea
                    value={form.memo}
                    onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                    placeholder="社内用メモ（印刷されません）"
                    rows={5}
                    className="text-sm resize-none"
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ──── 明細タブ ──────────────────────────────────────────────── */}
          <TabsContent value="items">
            <Card>
              <CardHeader className="bg-teal-700 text-white rounded-t-lg py-3 px-4 flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">明細入力</CardTitle>
                <span className="text-xs text-teal-200">行をクリックして編集 / 右端の＋で行追加</span>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b text-slate-500">
                      <th className="text-center px-2 py-2 w-8">No</th>
                      <th className="text-center px-2 py-2 w-14">階層</th>
                      <th className="text-left px-2 py-2 w-28">工種</th>
                      <th className="text-left px-2 py-2">品名・摘要</th>
                      <th className="text-right px-2 py-2 w-20">数量</th>
                      <th className="text-center px-2 py-2 w-14">単位</th>
                      <th className="text-right px-2 py-2 w-24">単価</th>
                      <th className="text-right px-2 py-2 w-28">見積金額</th>
                      <th className="text-center px-2 py-2 w-16">種別</th>
                      <th className="px-2 py-2 w-20 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const isSpecialRow = item.rowType !== "normal";
                      const amt = isSpecialRow
                        ? item.amount
                        : (item.quantity != null && item.unitPrice != null
                            ? Math.round(item.quantity * item.unitPrice)
                            : item.amount);

                      return (
                        <tr
                          key={item._key}
                          className={`border-b hover:bg-orange-50 transition-colors ${
                            item.rowType === "subtotal" ? "bg-slate-50 font-medium" :
                            item.rowType === "total" ? "bg-teal-50 font-bold" :
                            item.rowType === "tax" ? "bg-amber-50" :
                            item.rowType === "discount" ? "bg-red-50" : ""
                          }`}
                        >
                          <td className="px-2 py-1 text-center text-slate-400 text-xs">{idx + 1}</td>
                          <td className="px-2 py-1 text-center">
                            <Select
                              value={String(item.level)}
                              onValueChange={(v) => updateRow(item._key, { level: parseInt(v) as 1 | 2 | 3 })}
                            >
                              <SelectTrigger className="h-6 text-xs w-12 px-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1">大</SelectItem>
                                <SelectItem value="2">中</SelectItem>
                                <SelectItem value="3">小</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            {!isSpecialRow ? (
                              <Input
                                value={item.workType}
                                onChange={(e) => updateRow(item._key, { workType: e.target.value })}
                                list={`wt-list-${item._key}`}
                                placeholder="工種"
                                className="h-6 text-xs px-1 w-full"
                              />
                            ) : null}
                            <datalist id={`wt-list-${item._key}`}>
                              {workTypes?.map((wt) => (
                                <option key={wt.id} value={wt.name} />
                              ))}
                            </datalist>
                          </td>
                          <td className="px-2 py-1">
                            <div style={{ paddingLeft: `${(item.level - 1) * 16}px` }}>
                              <Input
                                value={item.itemName}
                                onChange={(e) => updateRow(item._key, { itemName: e.target.value })}
                                placeholder={isSpecialRow ? ROW_TYPE_LABELS[item.rowType] : "品名・摘要"}
                                className="h-6 text-xs px-1 w-full"
                              />
                            </div>
                          </td>
                          <td className="px-2 py-1">
                            {!isSpecialRow ? (
                              <Input
                                type="number"
                                value={item.quantity ?? ""}
                                onChange={(e) => updateRow(item._key, { quantity: e.target.value === "" ? null : parseFloat(e.target.value) })}
                                className="h-6 text-xs px-1 text-right w-full"
                              />
                            ) : null}
                          </td>
                          <td className="px-2 py-1">
                            {!isSpecialRow ? (
                              <Input
                                value={item.unit}
                                onChange={(e) => updateRow(item._key, { unit: e.target.value })}
                                list="unit-list"
                                className="h-6 text-xs px-1 text-center w-full"
                              />
                            ) : null}
                          </td>
                          <td className="px-2 py-1">
                            {!isSpecialRow ? (
                              <Input
                                type="number"
                                value={item.unitPrice ?? ""}
                                onChange={(e) => updateRow(item._key, { unitPrice: e.target.value === "" ? null : parseFloat(e.target.value) })}
                                className="h-6 text-xs px-1 text-right w-full"
                              />
                            ) : null}
                          </td>
                          <td className="px-2 py-1">
                            {isSpecialRow ? (
                              <Input
                                type="number"
                                value={item.amount}
                                onChange={(e) => updateRow(item._key, { amount: parseFloat(e.target.value) || 0 })}
                                className="h-6 text-xs px-1 text-right w-full font-semibold"
                              />
                            ) : (
                              <div className="text-right pr-1 font-medium text-slate-700">
                                {amt > 0 || (item.quantity != null && item.unitPrice != null) ? `¥${amt.toLocaleString()}` : "—"}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={item.rowType}
                              onValueChange={(v) => updateRow(item._key, { rowType: v as EstimateItem["rowType"] })}
                            >
                              <SelectTrigger className="h-6 text-xs w-16 px-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(ROW_TYPE_LABELS).map(([k, v]) => (
                                  <SelectItem key={k} value={k}>{v}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-0.5 justify-center">
                              <button
                                onClick={() => copyRowAbove(idx)}
                                disabled={idx === 0}
                                className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 text-slate-500"
                                title="上の行を複写"
                              >
                                ↑
                              </button>
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
                                title="行を削除"
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
              <div className="border-t bg-slate-50 px-4 py-3 flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addRow()}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  行を追加
                </Button>

                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <span className="text-xs text-slate-500 mr-3">税抜合計</span>
                    <span className="font-semibold text-slate-700">{fmt(taxExcluded)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 mr-3">消費税（{form.taxRate}%）</span>
                    <span className="font-semibold text-slate-700">{fmt(taxAmount)}</span>
                  </div>
                  <div className="text-right border-l pl-6">
                    <span className="text-xs text-slate-500 mr-3">見積金額</span>
                    <span className="text-lg font-bold text-orange-600">{fmt(taxIncluded)}</span>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 保存ボタン（下部） */}
        <div className="mt-6 flex justify-end">
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
            onClick={handleSave}
            disabled={saving}
          >
            <Save className="w-4 h-4" />
            {saving ? "保存中…" : "保存する"}
          </Button>
        </div>
      </div>
    </div>
  );
}
