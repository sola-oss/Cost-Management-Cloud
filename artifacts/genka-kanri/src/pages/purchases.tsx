import { useState, useCallback, useEffect } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, FileText, ExternalLink, ClipboardList } from "lucide-react";
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

interface AvailablePurchaseOrder {
  id: number;
  orderNumber: string;
  projectId: number;
  vendorId: number;
  orderDate: string;
  status: string;
  totalAmount: number;
  vendorName: string;
  projectCode: string;
  projectName: string;
  items: Array<{
    id: number;
    lineNumber: number;
    category: string;
    description: string;
    specification: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    amount: number;
    taxRate: number;
    deliveredQuantity: number;
  }>;
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

// ── 編集対象の仕入伝票型 ──────────────────────────────────────────────────────
interface PurchaseInvoiceDetail {
  id: number;
  voucherNumber: string;
  projectId: number;
  vendorId: number;
  purchaseDate: string;
  paymentDueDate: string | null;
  isProvisional: boolean;
  notes: string | null;
  items: Array<{
    category: string;
    description: string;
    specification: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    amount: number;
    taxRate: number;
    workTypeId: number | null;
  }>;
}

// ── メインコンポーネント ──────────────────────────────────────────────────────
export default function Purchases() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // 編集モード：URLパラメータ ?id= を読み取る
  const searchStr = useSearch();
  const editInvoiceId = new URLSearchParams(searchStr).get("id");
  const editInvoiceIdNum = editInvoiceId ? parseInt(editInvoiceId) : null;

  const { data: projectsData } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = projectsData?.items ?? [];
  const { data: vendorsData } = useVendors();
  const vendors = vendorsData?.items ?? [];
  const { data: workTypesData } = useWorkTypes();
  const workTypes = workTypesData ?? [];
  const [saving, setSaving] = useState(false);

  // 編集モード用：既存伝票データを取得
  const { data: editInvoiceData } = useQuery<PurchaseInvoiceDetail>({
    queryKey: ["/api/purchase-invoices/detail", editInvoiceIdNum],
    queryFn: async () => {
      const res = await fetch(`/api/purchase-invoices/${editInvoiceIdNum}`);
      if (!res.ok) throw new Error("Failed to fetch invoice");
      return res.json();
    },
    enabled: !!editInvoiceIdNum,
  });

  // 編集フォーム初期化済みフラグ
  const [editInitialized, setEditInitialized] = useState(false);

  // editInvoiceId が変わったらフラグをリセット
  useEffect(() => {
    setEditInitialized(false);
  }, [editInvoiceIdNum]);

  // ── 発注書取込モーダル状態 ──────────────────────────────────────────────
  const [importPOOpen, setImportPOOpen] = useState(false);
  const [importingPO, setImportingPO] = useState(false);
  const { data: availablePOs } = useQuery({
    queryKey: ["/api/purchase-orders/available-for-invoice", importPOOpen],
    queryFn: async () => {
      const res = await fetch("/api/purchase-orders/available-for-invoice");
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ items: AvailablePurchaseOrder[] }>;
    },
    enabled: importPOOpen,
  });

  // ── ヘッダー状態 ─────────────────────────────────────────────────────────
  const [purchaseDate,    setPurchaseDate]    = useState(TODAY);
  const [vendorId,        setVendorId]        = useState<string>("");
  const [paymentDueDate,  setPaymentDueDate]  = useState("");
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [orderNumber,     setOrderNumber]     = useState("");
  const [taxCalcType,     setTaxCalcType]     = useState("外税明細単位");
  const [isDraft,         setIsDraft]         = useState(false);
  const [memo,            setMemo]            = useState("");

  // ── 支払予定生成フラグ ────────────────────────────────────────────────────
  const [createPayment, setCreatePayment] = useState(false);

  // ── 編集データをフォームに反映（初回のみ）──────────────────────────────────
  useEffect(() => {
    if (!editInvoiceData || editInitialized) return;
    // workTypes が必要な場合は読み込み完了を待つ
    if (editInvoiceData.items.some(i => i.workTypeId) && workTypes.length === 0) return;

    const catReverseMap: Record<string, string> = {
      material: "610", subcontract: "620", labor: "630", expense: "640",
    };

    setPurchaseDate(editInvoiceData.purchaseDate);
    setVendorId(editInvoiceData.vendorId ? String(editInvoiceData.vendorId) : "");
    setPaymentDueDate(editInvoiceData.paymentDueDate ?? "");
    setSelectedProject(String(editInvoiceData.projectId));
    setIsDraft(editInvoiceData.isProvisional);
    setMemo(editInvoiceData.notes ?? "");
    setCreatePayment(false);

    setRows(
      editInvoiceData.items.length > 0
        ? editInvoiceData.items.map((item) => {
            const wt = workTypes.find(w => w.id === item.workTypeId);
            const amt = Number(item.amount) || 0;
            const tax = Math.floor(amt * (Number(item.taxRate) || 10) / 100);
            return {
              id: crypto.randomUUID(),
              categoryCode: catReverseMap[item.category] ?? "620",
              productName: item.description,
              spec: item.specification ?? "",
              unit: item.unit,
              quantity: String(item.quantity),
              unitPrice: String(item.unitPrice),
              taxRate: Number(item.taxRate) || 10,
              amount: amt,
              tax,
              workTypeCode: wt?.code ?? "",
            };
          })
        : [createRow()]
    );
    setEditInitialized(true);
  }, [editInvoiceData, editInitialized, workTypes]);

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
    setVendorId("");
    setPaymentDueDate("");
    setSelectedProject("");
    setOrderNumber("");
    setTaxCalcType("外税明細単位");
    setIsDraft(false);
    setMemo("");
    setCreatePayment(true);
    setRows([createRow()]);
  };

  // ── 登録 / 更新 ──────────────────────────────────────────────────────────
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
    const taxCalcMethodMap: Record<string, string> = {
      "外税明細単位": "detail_exclusive",
      "外税伝票単位": "total_exclusive",
      "内税": "detail_inclusive",
      "非課税": "detail_exclusive",
    };

    const parsedVendorId = vendorId && vendorId !== "none" ? parseInt(vendorId) : undefined;
    const itemsPayload = validRows.map((row, idx) => ({
      lineNumber: idx + 1,
      category: categoryMap[row.categoryCode] ?? "expense",
      description: [row.productName, row.spec].filter(Boolean).join(" ") || "（摘要なし）",
      quantity: parseFloat(row.quantity) || 1,
      unit: row.unit || "式",
      unitPrice: parseFloat(row.unitPrice) || 0,
      amount: row.amount,
      taxRate: row.taxRate,
      workTypeId: row.workTypeCode && row.workTypeCode !== "__none__"
        ? (workTypes.find(wt => wt.code === row.workTypeCode)?.id ?? null)
        : null,
    }));

    setSaving(true);
    try {
      let res: Response;

      if (editInvoiceIdNum) {
        // ── 編集モード：PATCH ───────────────────────────────────────────
        res = await fetch(`/api/purchase-invoices/${editInvoiceIdNum}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            purchaseDate,
            paymentDueDate: paymentDueDate || null,
            isProvisional: isDraft,
            notes: memo || null,
            items: itemsPayload,
          }),
        });
        if (!res.ok) throw new Error("Failed to update purchase invoice");
        const invoice = await res.json() as { voucherNumber: string };
        toast({
          title: "更新完了",
          description: `仕入伝票 ${invoice.voucherNumber} を更新しました。`,
        });
      } else {
        // ── 新規作成：POST ──────────────────────────────────────────────
        res = await fetch("/api/purchase-invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: parseInt(selectedProject),
            vendorId: parsedVendorId,
            purchaseDate,
            paymentDueDate: paymentDueDate || null,
            isProvisional: isDraft,
            taxCalculationMethod: taxCalcMethodMap[taxCalcType] ?? "detail_exclusive",
            notes: memo || null,
            createPayment,
            items: itemsPayload,
          }),
        });
        if (!res.ok) throw new Error("Failed to create purchase invoice");
        const invoice = await res.json() as { voucherNumber: string };
        if (createPayment) {
          queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        }
        toast({
          title: "登録完了",
          description: `仕入伝票 ${invoice.voucherNumber} を登録しました。${createPayment ? "支払予定も作成しました。" : ""}`,
        });
        newSlip();
      }

      queryClient.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cost-items"] });
    } catch {
      toast({ title: editInvoiceIdNum ? "更新エラー" : "登録エラー", description: "処理に失敗しました。内容を確認してください。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── 発注書取込 ──────────────────────────────────────────────────────────
  const handleImportFromPO = async (po: AvailablePurchaseOrder) => {
    if (!window.confirm(`発注書 ${po.orderNumber} から仕入伝票を作成しますか？`)) return;
    setImportingPO(true);
    try {
      const res = await fetch(`/api/purchase-invoices/from-order/${po.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentDueDate: paymentDueDate || null,
          createPayment,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const invoice = await res.json() as { voucherNumber: string };
      toast({ title: "取込完了", description: `仕入伝票 ${invoice.voucherNumber} を作成しました。` });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      if (createPayment) queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      setImportPOOpen(false);
    } catch {
      toast({ title: "取込エラー", description: "取込に失敗しました。", variant: "destructive" });
    } finally {
      setImportingPO(false);
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
          <h1 className="text-xl font-bold text-slate-900">
            {editInvoiceIdNum
              ? `仕入伝票 編集${editInvoiceData ? ` — ${editInvoiceData.voucherNumber}` : ""}`
              : "仕入入力"}
          </h1>
          {isDraft && (
            <Badge variant="outline" className="text-amber-600 border-amber-400 bg-amber-50">
              仮伝票
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editInvoiceIdNum && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportPOOpen(true)}
              className="text-teal-700 border-teal-300 hover:bg-teal-50"
            >
              <ClipboardList className="w-3.5 h-3.5 mr-1" />
              発注書から取込
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => editInvoiceIdNum ? navigate("/purchases") : newSlip()}
          >
            {editInvoiceIdNum ? "一覧に戻る" : "新規"}
          </Button>
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-700 text-white"
            onClick={handleRegister}
            disabled={saving}
          >
            {saving ? (
              <span className="flex items-center gap-1.5"><span className="animate-spin">⏳</span>{editInvoiceIdNum ? "更新中..." : "登録中..."}</span>
            ) : (
              <span className="flex items-center gap-1.5"><Save className="w-3.5 h-3.5" />{editInvoiceIdNum ? "更新する" : "登録"}</span>
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
                    value={editInvoiceData?.voucherNumber ?? "（自動採番）"}
                    readOnly
                    className="text-sm font-mono bg-slate-50 text-slate-500 cursor-default"
                  />
                  {!editInvoiceIdNum && (
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">登録時に採番</span>
                  )}
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
                {vendors.length === 0 ? (
                  <div className="flex items-center gap-2 py-1.5">
                    <span className="text-xs text-slate-400">仕入先が未登録です。</span>
                    <Link href="/vendors" className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 hover:underline font-medium">
                      <ExternalLink className="w-3 h-3" />
                      新規登録
                    </Link>
                  </div>
                ) : (
                  <Select value={vendorId} onValueChange={setVendorId}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="仕入先を選択してください" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">（指定なし）</SelectItem>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
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
                  <span className="ml-2 text-xs text-slate-400">※通常は支払査定から登録されます</span>
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
        <Button
          variant="outline"
          size="default"
          onClick={() => editInvoiceIdNum ? navigate("/purchases") : newSlip()}
          className="px-6"
        >
          {editInvoiceIdNum ? "一覧に戻る" : "キャンセル"}
        </Button>
        <Button
          size="default"
          className="bg-orange-500 hover:bg-orange-600 text-white px-8"
          onClick={handleRegister}
          disabled={saving}
        >
          {saving ? (
            <span className="flex items-center gap-1.5">
              <span className="animate-spin inline-block">⏳</span>{editInvoiceIdNum ? "更新中..." : "登録中..."}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Save className="w-4 h-4" />{editInvoiceIdNum ? "更新する" : "登録する"}
            </span>
          )}
        </Button>
      </div>

      {/* ── 発注書取込モーダル ── */}
      <Dialog open={importPOOpen} onOpenChange={setImportPOOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              発注書から仕入伝票を作成
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 mb-3">
            発注済・一部納品の発注書から仕入伝票を作成します。未納品数量が自動的に取り込まれます。
          </p>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 text-xs">
                <TableHead className="font-medium">発注番号</TableHead>
                <TableHead className="font-medium">工事</TableHead>
                <TableHead className="font-medium">仕入先</TableHead>
                <TableHead className="font-medium">発注日</TableHead>
                <TableHead className="font-medium text-right">合計</TableHead>
                <TableHead className="font-medium text-center w-20">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!availablePOs || availablePOs.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6 text-slate-400 text-sm">
                    取込可能な発注書がありません（発注済または一部納品のものが対象です）
                  </TableCell>
                </TableRow>
              ) : (
                availablePOs.items.map((po) => (
                  <TableRow key={po.id} className="hover:bg-slate-50/60">
                    <TableCell className="font-mono text-sm text-teal-700 font-medium">{po.orderNumber}</TableCell>
                    <TableCell className="text-sm">
                      <div>{po.projectCode}</div>
                      <div className="text-xs text-slate-500">{po.projectName}</div>
                    </TableCell>
                    <TableCell className="text-sm">{po.vendorName}</TableCell>
                    <TableCell className="text-sm text-slate-600">{po.orderDate}</TableCell>
                    <TableCell className="text-right font-medium text-sm">
                      ¥{po.totalAmount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs bg-teal-600 hover:bg-teal-700 text-white"
                        onClick={() => handleImportFromPO(po)}
                        disabled={importingPO}
                      >
                        取込
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

    </div>
  );
}
