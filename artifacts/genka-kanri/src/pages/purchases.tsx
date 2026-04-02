import { useState, useCallback } from "react";
import { useListProjects, useCreateCostItem, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface WorkTypeItem {
  id: number;
  code: string;
  name: string;
  constructionType: string;
}

function useWorkTypes() {
  return useQuery({
    queryKey: ["/api/work-types"],
    queryFn: async () => {
      const res = await fetch("/api/work-types");
      if (!res.ok) throw new Error("Failed to fetch work types");
      return res.json() as Promise<WorkTypeItem[]>;
    },
  });
}

// ── 定数 ─────────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().split("T")[0];

function generateSlipNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const key = `slip_seq_${ymd}`;
  const current = parseInt(localStorage.getItem(key) ?? "0", 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));
  return `ST-${ymd}-${String(next).padStart(4, "0")}`;
}

const CATEGORY_OPTIONS = [
  { code: "610", name: "材料費",  value: "material"    as const },
  { code: "620", name: "外注費",  value: "subcontract" as const },
  { code: "630", name: "労務費",  value: "labor"       as const },
  { code: "640", name: "経費",    value: "expense"     as const },
];

const TAX_RATE_OPTIONS = [
  { value: 10, label: "10%" },
  { value: 8,  label: "8%（軽減）" },
  { value: 0,  label: "非課税" },
];

// ── 型 ───────────────────────────────────────────────────────────────────────
interface DetailRow {
  id: string;
  categoryCode: string;
  productName: string;
  spec: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxRate: number;
  amount: number;
  tax: number;
  workTypeCode: string;
}

function createRow(): DetailRow {
  return {
    id: crypto.randomUUID(),
    categoryCode: "620",
    productName: "",
    spec: "",
    unit: "式",
    quantity: "1",
    unitPrice: "",
    taxRate: 10,
    amount: 0,
    tax: 0,
    workTypeCode: "",
  };
}

function recalc(row: DetailRow): DetailRow {
  const q = parseFloat(row.quantity) || 0;
  const u = parseFloat(row.unitPrice) || 0;
  const amount = Math.floor(q * u);
  const tax = row.taxRate > 0 ? Math.floor(amount * row.taxRate / 100) : 0;
  return { ...row, amount, tax };
}

interface VendorItem {
  id: number;
  name: string;
}

function useVendors() {
  return useQuery({
    queryKey: ["/api/vendors"],
    queryFn: async () => {
      const res = await fetch("/api/vendors");
      if (!res.ok) throw new Error("Failed to fetch vendors");
      return res.json() as Promise<{ items: VendorItem[] }>;
    },
  });
}

// ── メインコンポーネント ──────────────────────────────────────────────────────
export default function Purchases() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: projectsData } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = projectsData?.items ?? [];
  const { data: vendorsData } = useVendors();
  const vendorNames = vendorsData?.items?.map((v) => v.name) ?? [];
  const { data: workTypesData } = useWorkTypes();
  const workTypes = workTypesData ?? [];
  const createCostItem = useCreateCostItem();
  const [saving, setSaving] = useState(false);

  // ── ヘッダー状態 ─────────────────────────────────────────────────────────
  const [slipNumber]      = useState(() => generateSlipNumber());
  const [purchaseDate,    setPurchaseDate]    = useState(TODAY);
  const [vendorName,      setVendorName]      = useState("");
  const [paymentDueDate,  setPaymentDueDate]  = useState("");
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [orderNumber,     setOrderNumber]     = useState("");
  const [taxCalcType,     setTaxCalcType]     = useState("外税明細単位");
  const [isDraft,         setIsDraft]         = useState(false);
  const [memo,            setMemo]            = useState("");

  // ── 支払予定生成フラグ ────────────────────────────────────────────────────
  const [createPayment, setCreatePayment] = useState(true);

  // ── 明細行状態 ───────────────────────────────────────────────────────────
  const [rows, setRows] = useState<DetailRow[]>([createRow()]);

  // ── 選択中工事 ───────────────────────────────────────────────────────────
  const currentProject = projects.find(p => String(p.id) === selectedProject);

  // ── 行変更ハンドラ ────────────────────────────────────────────────────────
  const handleRowChange = useCallback((idx: number, field: keyof DetailRow, value: string | number) => {
    setRows(prev => {
      const next = [...prev];
      let row: DetailRow = { ...next[idx], [field]: value };
      if (["quantity", "unitPrice", "taxRate"].includes(field as string)) {
        row = recalc(row);
      }
      next[idx] = row;
      return next;
    });
  }, []);

  const addRow = () => setRows(prev => [...prev, createRow()]);

  const deleteRow = (idx: number) => {
    setRows(prev => {
      if (prev.length === 1) return [createRow()];
      return prev.filter((_, i) => i !== idx);
    });
  };

  const duplicateRow = (idx: number) => {
    setRows(prev => {
      const next = [...prev];
      next.splice(idx + 1, 0, { ...prev[idx], id: crypto.randomUUID() });
      return next;
    });
  };

  const newSlip = () => {
    setPurchaseDate(TODAY);
    setVendorName("");
    setPaymentDueDate("");
    setSelectedProject("");
    setOrderNumber("");
    setTaxCalcType("外税明細単位");
    setIsDraft(false);
    setMemo("");
    setCreatePayment(true);
    setRows([createRow()]);
  };

  // ── 登録 ─────────────────────────────────────────────────────────────────
  const handleRegister = async () => {
    if (!selectedProject) {
      toast({ title: "入力エラー", description: "工事を選択してください。", variant: "destructive" });
      return;
    }
    const validRows = rows.filter(r => r.amount > 0 || r.productName.trim());
    if (validRows.length === 0) {
      toast({ title: "入力エラー", description: "明細を1件以上入力してください。", variant: "destructive" });
      return;
    }

    const categoryMap: Record<string, "material" | "labor" | "subcontract" | "expense"> = {
      "610": "material", "620": "subcontract", "630": "labor", "640": "expense",
    };

    setSaving(true);
    try {
      await Promise.all(
        validRows.map(row =>
          createCostItem.mutateAsync({
            data: {
              projectId: parseInt(selectedProject),
              category: categoryMap[row.categoryCode] ?? "expense",
              incurredDate: purchaseDate,
              description: [row.productName, row.spec].filter(Boolean).join(" ") || "（摘要なし）",
              vendor: vendorName || undefined,
              quantity: row.quantity ? parseFloat(row.quantity) : undefined,
              unit: row.unit || undefined,
              unitPrice: row.unitPrice ? parseFloat(row.unitPrice) : undefined,
              amount: row.amount,
              invoiceNumber: slipNumber || undefined,
            },
          })
        )
      );

      let paymentCreated = false;
      if (createPayment) {
        const res = await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: parseInt(selectedProject),
            vendor: vendorName || "（仕入先未入力）",
            description: `仕入伝票 ${slipNumber}`,
            amount: totalGross,
            dueDate: paymentDueDate || undefined,
            invoiceNumber: slipNumber,
          }),
        });
        if (res.ok) {
          paymentCreated = true;
          queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        } else {
          toast({
            title: "支払予定の登録に失敗しました",
            description: "仕入明細は登録済みです。支払管理画面から手動で追加してください。",
            variant: "destructive",
          });
        }
      }

      const desc = paymentCreated
        ? `${validRows.length}件の仕入明細を登録しました。支払予定も登録しました。`
        : `${validRows.length}件の仕入明細を登録しました。`;
      toast({ title: "登録完了", description: desc });
      queryClient.invalidateQueries({ queryKey: ["/api/cost-items"] });
      newSlip();
    } catch {
      toast({ title: "登録エラー", description: "登録に失敗しました。内容を確認してください。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── 合計 ─────────────────────────────────────────────────────────────────
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const totalTax    = rows.reduce((s, r) => s + r.tax, 0);
  const totalGross  = totalAmount + totalTax;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">

      {/* ── ページヘッダー ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-teal-700" />
          <h1 className="text-xl font-bold text-slate-900">仕入入力</h1>
          {isDraft && (
            <Badge variant="outline" className="text-amber-600 border-amber-400 bg-amber-50">
              仮伝票
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={newSlip}>
            新規
          </Button>
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-700 text-white"
            onClick={handleRegister}
            disabled={saving}
          >
            {saving ? (
              <span className="flex items-center gap-1.5"><span className="animate-spin">⏳</span>登録中...</span>
            ) : (
              <span className="flex items-center gap-1.5"><Save className="w-3.5 h-3.5" />登録</span>
            )}
          </Button>
        </div>
      </div>

      {/* ── 基本情報カード（2カラム） ── */}
      <Card>
        <CardHeader className="py-2 px-4 border-b bg-teal-700">
          <CardTitle className="text-xs font-semibold text-white">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3">

            {/* ── 左カラム ── */}
            <div className="space-y-3">
              {/* 伝票番号 */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">伝票番号</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={slipNumber}
                    readOnly
                    className="text-sm font-mono bg-slate-50 text-slate-600 cursor-default"
                  />
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">自動採番</span>
                </div>
              </div>

              {/* 仕入日 */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">仕入日 <span className="text-red-500">*</span></Label>
                <Input
                  type="date"
                  value={purchaseDate}
                  onChange={e => setPurchaseDate(e.target.value)}
                  className="text-sm"
                />
              </div>

              {/* 仕入先 */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">仕入先</Label>
                <Input
                  value={vendorName}
                  onChange={e => setVendorName(e.target.value)}
                  placeholder="例: 山田建材株式会社"
                  className="text-sm"
                  list="vendor-suggestions"
                />
                <datalist id="vendor-suggestions">
                  {vendorNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              {/* 支払予定日 */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">支払予定日</Label>
                <Input
                  type="date"
                  value={paymentDueDate}
                  onChange={e => setPaymentDueDate(e.target.value)}
                  className="text-sm"
                />
              </div>
            </div>

            {/* ── 右カラム ── */}
            <div className="space-y-3">
              {/* 工事選択 */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">工事 <span className="text-red-500">*</span></Label>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="工事を選択してください" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.projectCode} {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentProject && (
                  <p className="text-[11px] text-teal-700">{currentProject.name}</p>
                )}
              </div>

              {/* 注文番号 */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">注文番号</Label>
                <Input
                  value={orderNumber}
                  onChange={e => setOrderNumber(e.target.value)}
                  placeholder="例: PO-20260401-001"
                  className="text-sm"
                />
              </div>

              {/* 税計算方式 */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">税計算方式</Label>
                <Select value={taxCalcType} onValueChange={setTaxCalcType}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="外税明細単位">外税明細単位</SelectItem>
                    <SelectItem value="外税伝票単位">外税伝票単位</SelectItem>
                    <SelectItem value="内税">内税</SelectItem>
                    <SelectItem value="非課税">非課税</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 仮伝票 */}
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="isDraft"
                  checked={isDraft}
                  onCheckedChange={v => setIsDraft(!!v)}
                  className="accent-teal-600"
                />
                <Label htmlFor="isDraft" className="text-sm text-slate-700 cursor-pointer">
                  仮伝票として保存する
                </Label>
              </div>

              {/* 支払予定を作成する */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="createPayment"
                  checked={createPayment}
                  onCheckedChange={v => setCreatePayment(!!v)}
                  className="accent-teal-600"
                />
                <Label htmlFor="createPayment" className="text-sm text-slate-700 cursor-pointer">
                  支払予定も作成する
                </Label>
              </div>
            </div>

          </div>
        </CardContent>
      </Card>

      {/* ── 明細カード ── */}
      <Card>
        <CardHeader className="py-2 px-4 border-b bg-teal-700 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold text-white">明細</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-white hover:bg-teal-600 text-xs"
            onClick={addRow}
          >
            <Plus className="w-3 h-3 mr-1" />行を追加
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs border-b border-slate-200">
                  <th className="px-3 py-2 text-center w-8 font-medium">No</th>
                  <th className="px-3 py-2 text-left w-28 font-medium">科目</th>
                  <th className="px-3 py-2 text-left font-medium">品名・摘要</th>
                  <th className="px-3 py-2 text-right w-24 font-medium">数量</th>
                  <th className="px-3 py-2 text-center w-14 font-medium">単位</th>
                  <th className="px-3 py-2 text-right w-28 font-medium">単価</th>
                  <th className="px-3 py-2 text-right w-28 font-medium">金額</th>
                  <th className="px-3 py-2 text-center w-24 font-medium">消費税率</th>
                  <th className="px-3 py-2 text-left w-28 font-medium">工種</th>
                  <th className="px-3 py-2 text-center w-10 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const cat = CATEGORY_OPTIONS.find(c => c.code === row.categoryCode);
                  return (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60 group">
                      {/* No */}
                      <td className="px-3 py-2 text-center text-xs text-slate-400 font-mono">
                        {idx + 1}
                      </td>
                      {/* 科目 */}
                      <td className="px-2 py-1.5">
                        <Select
                          value={row.categoryCode}
                          onValueChange={v => handleRowChange(idx, "categoryCode", v)}
                        >
                          <SelectTrigger className="h-8 text-xs border-slate-200">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CATEGORY_OPTIONS.map(c => (
                              <SelectItem key={c.code} value={c.code} className="text-xs">
                                {c.code} {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {/* 品名・摘要 */}
                      <td className="px-2 py-1.5">
                        <Input
                          value={row.productName}
                          onChange={e => handleRowChange(idx, "productName", e.target.value)}
                          placeholder="品名"
                          className="h-8 text-xs mb-1"
                        />
                        <Input
                          value={row.spec}
                          onChange={e => handleRowChange(idx, "spec", e.target.value)}
                          placeholder="仕様・摘要"
                          className="h-7 text-xs text-slate-500"
                        />
                      </td>
                      {/* 数量 */}
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          value={row.quantity}
                          onChange={e => handleRowChange(idx, "quantity", e.target.value)}
                          className="h-8 text-xs text-right"
                        />
                      </td>
                      {/* 単位 */}
                      <td className="px-2 py-1.5">
                        <Input
                          value={row.unit}
                          onChange={e => handleRowChange(idx, "unit", e.target.value)}
                          className="h-8 text-xs text-center"
                        />
                      </td>
                      {/* 単価 */}
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          value={row.unitPrice}
                          onChange={e => handleRowChange(idx, "unitPrice", e.target.value)}
                          placeholder="0"
                          className="h-8 text-xs text-right"
                        />
                      </td>
                      {/* 金額 */}
                      <td className="px-3 py-2 text-right text-sm font-mono text-slate-800">
                        {row.amount > 0 ? row.amount.toLocaleString() : <span className="text-slate-300">—</span>}
                      </td>
                      {/* 消費税率 */}
                      <td className="px-2 py-1.5">
                        <Select
                          value={String(row.taxRate)}
                          onValueChange={v => handleRowChange(idx, "taxRate", Number(v))}
                        >
                          <SelectTrigger className="h-8 text-xs border-slate-200">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TAX_RATE_OPTIONS.map(t => (
                              <SelectItem key={t.value} value={String(t.value)} className="text-xs">
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {/* 工種 */}
                      <td className="px-2 py-1.5">
                        <Select
                          value={row.workTypeCode || "__none__"}
                          onValueChange={v => handleRowChange(idx, "workTypeCode", v === "__none__" ? "" : v)}
                        >
                          <SelectTrigger className="h-8 text-xs border-slate-200 min-w-[110px]">
                            <SelectValue placeholder="工種" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__" className="text-xs text-slate-400">— 未選択 —</SelectItem>
                            {workTypes.map(wt => (
                              <SelectItem key={wt.id} value={wt.code} className="text-xs">
                                <span className="font-mono text-slate-500 mr-1">{wt.code}</span>
                                {wt.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {/* 削除 */}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => deleteRow(idx)}
                          title="行を削除"
                          className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 行追加ボタン */}
          <button
            type="button"
            onClick={addRow}
            className="w-full py-2.5 text-xs text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors border-t border-dashed border-slate-200"
          >
            <Plus className="w-3 h-3 inline mr-1" />
            クリックして行を追加
          </button>
        </CardContent>
      </Card>

      {/* ── フッター ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 左：備考 */}
        <Card>
          <CardHeader className="py-2 px-4 border-b bg-teal-700">
            <CardTitle className="text-xs font-semibold text-white">備考</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 pb-3">
            <Textarea
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="備考・特記事項を入力"
              className="text-sm resize-none"
              rows={4}
            />
          </CardContent>
        </Card>

        {/* 右：合計金額 */}
        <Card>
          <CardHeader className="py-2 px-4 border-b bg-teal-700">
            <CardTitle className="text-xs font-semibold text-white">合計金額</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="text-sm text-slate-500">税抜金額</span>
              <span className="text-xl font-bold font-mono text-slate-700">
                ¥{totalAmount.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="text-sm text-slate-500">消費税額</span>
              <span className="text-xl font-bold font-mono text-blue-500">
                ¥{totalTax.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-base font-semibold text-slate-700">合計金額</span>
              <span className="text-3xl font-bold font-mono text-teal-700">
                ¥{totalGross.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* ── アクションボタン ── */}
      <div className="flex items-center justify-end gap-3 pb-6">
        <Button variant="outline" size="default" onClick={newSlip} className="px-6">
          キャンセル
        </Button>
        <Button
          size="default"
          className="bg-orange-500 hover:bg-orange-600 text-white px-8"
          onClick={handleRegister}
          disabled={saving}
        >
          {saving ? (
            <span className="flex items-center gap-1.5">
              <span className="animate-spin inline-block">⏳</span>登録中...
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Save className="w-4 h-4" />登録する
            </span>
          )}
        </Button>
      </div>

    </div>
  );
}
