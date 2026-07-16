import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useVendors } from "@/hooks/use-vendors";
import { useWorkTypes } from "@/hooks/use-work-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useHighlightNew } from "@/hooks/use-highlight-new";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Save, FileText, ExternalLink, ClipboardList, Pencil, ChevronDown, ChevronRight, Copy, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UnitPricePicker, type UnitPriceSelection } from "@/components/unit-price-picker";
import { ItemNameInput } from "@/components/item-name-input";

interface WorkTypeItem {
  id: number;
  code: string;
  name: string;
  constructionType: string;
}

/** 検索できる工種セレクト（全工種をスクロール表示＋名前/コードで絞り込み） */
function WorkTypeSelect({
  value, onChange, workTypes,
}: { value: string; onChange: (code: string) => void; workTypes: WorkTypeItem[] }) {
  const selected = workTypes.find(wt => wt.code === value);
  return (
    <Select
      value={value || "__none__"}
      onValueChange={v => onChange(v === "__none__" ? "" : v)}
    >
      <SelectTrigger className="h-8 text-xs border-slate-200 min-w-[130px]">
        <SelectValue placeholder="工種を選択">
          {selected ? (
            <span><span className="font-mono text-slate-400 mr-1">{selected.code}</span>{selected.name}</span>
          ) : (
            <span className="text-slate-400">工種を選択</span>
          )}
        </SelectValue>
      </SelectTrigger>
      {/* 検索欄は共通Selectの自動検索（10件以上で表示）に任せる */}
      <SelectContent className="max-h-[320px]" searchPlaceholder="工種名・コードで検索...">
        <SelectItem value="__none__" className="text-xs text-slate-400">— 未選択 —</SelectItem>
        {workTypes.map(wt => (
          <SelectItem key={wt.id} value={wt.code} className="text-xs">
            <span className="font-mono text-slate-500 mr-1">{wt.code}</span>
            {wt.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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

// ── 仕入伝票一覧用 ─────────────────────────────────────────────────────────────
interface PurchaseInvoiceSummary {
  id: number;
  voucherNumber: string;
  projectId: number;
  vendorId: number;
  purchaseDate: string;
  paymentDueDate: string | null;
  status: string;
  isProvisional: boolean;
  totalAmount: number;
  vendorName: string;
  projectCode: string;
  projectName: string;
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  provisional: "仮確定",
  confirmed:   "確定",
  assessed:    "査定済",
  paid:        "支払済",
  cancelled:   "キャンセル",
};

const INVOICE_STATUS_COLORS: Record<string, string> = {
  provisional: "bg-amber-100 text-amber-700 border-amber-200",
  confirmed:   "bg-blue-100 text-blue-700 border-blue-200",
  assessed:    "bg-purple-100 text-purple-700 border-purple-200",
  paid:        "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled:   "bg-red-100 text-red-700 border-red-200",
};

function usePurchaseInvoiceList(projectId: string, status: string) {
  const params = new URLSearchParams();
  if (projectId !== "__all__") params.set("projectId", projectId);
  if (status !== "__all__") params.set("status", status);
  return useQuery({
    queryKey: ["/api/purchase-invoices", projectId, status],
    queryFn: async () => {
      const res = await fetch(`/api/purchase-invoices?${params.toString()}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ items: PurchaseInvoiceSummary[]; total: number }>;
    },
  });
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
  bankAccountHolderKana?: string;
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
  const { mark, isNew } = useHighlightNew();
  const [, navigate] = useLocation();
  const quantityRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // 編集モード：URLパラメータ ?id= を読み取る
  const searchStr = useSearch();
  const editInvoiceId = new URLSearchParams(searchStr).get("id");
  const editInvoiceIdNum = editInvoiceId ? parseInt(editInvoiceId) : null;

  const { data: projectsData } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = projectsData?.items ?? [];
  const { data: vendors = [] } = useVendors<VendorItem>();
  const { data: workTypesData } = useWorkTypes<WorkTypeItem>();
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

  // ── 仕入伝票一覧フィルター ────────────────────────────────────────────────
  const [filterInvoiceProject, setFilterInvoiceProject] = useState("__all__");
  const [filterInvoiceStatus, setFilterInvoiceStatus] = useState("__all__");
  const { data: invoiceListData, isLoading: invoiceListLoading } =
    usePurchaseInvoiceList(filterInvoiceProject, filterInvoiceStatus);
  const invoiceList = invoiceListData?.items ?? [];

  // ── 注文書取込モーダル状態 ──────────────────────────────────────────────
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

  // ── 単価マスタへ新規登録（単価マスタに無い品目をその場で登録） ──────────────
  const [registeringRow, setRegisteringRow] = useState<string | null>(null);
  // 単価マスタから選ばれた品目を明細行に反映する（品名サジェスト／単価選択ダイアログ共通）
  const applyUnitPrice = (idx: number, sel: UnitPriceSelection) => {
    setRows(prev => {
      const next = [...prev];
      let r = { ...next[idx] };
      r.productName = sel.itemName;
      r.unit = sel.unit;
      r.unitPrice = sel.unitPrice;
      // 商品の工種を自動セット（単価マスタで決まっている工種を反映）
      if (sel.workTypeCode) r.workTypeCode = sel.workTypeCode;
      r = recalc(r);
      next[idx] = r;
      return next;
    });
    // 選択後に数量フィールドへフォーカス
    setTimeout(() => quantityRefs.current[idx]?.focus(), 50);
  };

  const handleRegisterUnitPrice = async (row: DetailRow) => {
    if (!vendorId || vendorId === "none") {
      toast({ title: "仕入先を選択してください", variant: "destructive" });
      return;
    }
    if (!row.productName.trim()) {
      toast({ title: "品名を入力してください", variant: "destructive" });
      return;
    }
    const price = parseFloat(row.unitPrice);
    if (!row.unitPrice || Number.isNaN(price) || price <= 0) {
      toast({ title: "単価を入力してください", variant: "destructive" });
      return;
    }
    const workTypeId = row.workTypeCode
      ? (workTypes.find(w => w.code === row.workTypeCode)?.id ?? null)
      : null;
    const name = row.productName.trim();
    setRegisteringRow(row.id);
    try {
      const post = (forceUpdate: boolean) =>
        fetch("/api/unit-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendorId: parseInt(vendorId),
            workTypeId,
            itemName: name,
            unit: row.unit || "式",
            unitPrice: price,
            forceUpdate,
          }),
        });

      let res = await post(false);
      let data = await res.json().catch(() => ({}));

      // 同じ仕入先・工種・品名で単価違いが既にある場合は、上書き更新するか確認する
      if (res.status === 409 && data?.status === "conflict") {
        const oldPrice = Number(data.existing?.unitPrice ?? 0);
        const ok = window.confirm(
          `「${name}」は既に ${oldPrice.toLocaleString()}円 で単価マスタに登録されています。\n` +
          `${price.toLocaleString()}円 に更新しますか？`,
        );
        if (!ok) return;
        res = await post(true);
        data = await res.json().catch(() => ({}));
      }

      if (!res.ok) throw new Error("failed");
      queryClient.invalidateQueries({ queryKey: ["/api/unit-prices"] });
      if (data?.status === "unchanged") {
        toast({ title: "登録済みです", description: `${name}（${price.toLocaleString()}円）は既に同じ単価で登録されています` });
      } else if (data?.status === "updated") {
        toast({ title: "単価マスタを更新しました", description: `${name}（${price.toLocaleString()}円）` });
      } else {
        toast({ title: "単価マスタに登録しました", description: `${name}（${price.toLocaleString()}円）` });
      }
    } catch {
      toast({ title: "登録に失敗しました", variant: "destructive" });
    } finally {
      setRegisteringRow(null);
    }
  };

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
        const invoice = await res.json() as { id: number; voucherNumber: string };
        toast({
          title: "更新完了",
          description: `仕入伝票 ${invoice.voucherNumber} を更新しました。`,
        });
        mark(invoice.id ?? editInvoiceIdNum);
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
        const invoice = await res.json() as { id: number; voucherNumber: string };
        if (createPayment) {
          queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        }
        toast({
          title: "登録完了",
          description: `仕入伝票 ${invoice.voucherNumber} を登録しました。${createPayment ? "支払予定も作成しました。" : ""}`,
        });
        newSlip();
        mark(invoice.id);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cost-items"] });
    } catch {
      toast({ title: editInvoiceIdNum ? "更新エラー" : "登録エラー", description: "処理に失敗しました。内容を確認してください。", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── 注文書取込 ──────────────────────────────────────────────────────────
  const handleImportFromPO = async (po: AvailablePurchaseOrder) => {
    if (!window.confirm(`注文書 ${po.orderNumber} から仕入伝票を作成しますか？`)) return;
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
      const invoice = await res.json() as { id: number; voucherNumber: string };
      toast({ title: "取込完了", description: `仕入伝票 ${invoice.voucherNumber} を作成しました。` });
      mark(invoice.id);
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

  // ── 仕入伝票の削除 ─────────────────────────────────────────────────────────
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<number | null>(null);
  const handleDeleteInvoice = async (inv: PurchaseInvoiceSummary) => {
    if (inv.status === "paid" || inv.status === "assessed") {
      toast({ title: "削除できません", description: "支払済・査定済の伝票は削除できません。", variant: "destructive" });
      return;
    }
    if (!window.confirm(`仕入伝票 ${inv.voucherNumber} を削除しますか？\nこの伝票に紐づく原価明細も削除され、実績原価に反映されます。`)) return;
    setDeletingInvoiceId(inv.id);
    try {
      const res = await fetch(`/api/purchase-invoices/${inv.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "削除に失敗しました");
      }
      toast({ title: "削除しました", description: `仕入伝票 ${inv.voucherNumber} を削除しました。` });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cost-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      // 編集中の伝票を消したらフォームを新規に戻す
      if (editInvoiceIdNum === inv.id) navigate("/purchases");
    } catch (err) {
      const message = err instanceof Error ? err.message : "削除に失敗しました";
      toast({ title: "削除エラー", description: message, variant: "destructive" });
    } finally {
      setDeletingInvoiceId(null);
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
              注文書から取込
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

      {/* ── 基本情報カード ── */}
      <Card>
        <CardHeader className="py-2 px-4 border-b bg-teal-700">
          <CardTitle className="text-xs font-semibold text-white">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 pb-4">
          {/* ── 主要項目（常時表示）── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3">
            {/* 工事（最重要・先頭） */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-600 font-medium">
                工事 <span className="text-red-500">*</span>
                {editInvoiceIdNum && <span className="ml-1.5 text-[11px] font-normal text-slate-400">（編集中は変更不可）</span>}
              </Label>
              <Select value={selectedProject} onValueChange={setSelectedProject} disabled={!!editInvoiceIdNum}>
                <SelectTrigger className="text-sm disabled:opacity-70 disabled:bg-slate-50">
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
            </div>

            {/* 仕入先 */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-600 font-medium">
                仕入先
                {editInvoiceIdNum && <span className="ml-1.5 text-[11px] font-normal text-slate-400">（編集中は変更不可）</span>}
              </Label>
              {vendors.length === 0 ? (
                <div className="flex items-center gap-2 py-1.5">
                  <span className="text-xs text-slate-400">仕入先が未登録です。</span>
                  <Link href="/vendors" className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 hover:underline font-medium">
                    <ExternalLink className="w-3 h-3" />
                    新規登録
                  </Link>
                </div>
              ) : (
                <Select value={vendorId} onValueChange={setVendorId} disabled={!!editInvoiceIdNum}>
                  <SelectTrigger className="text-sm disabled:opacity-70 disabled:bg-slate-50">
                    <SelectValue placeholder="仕入先を選択してください" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">（指定なし）</SelectItem>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={String(v.id)} data-search-text={v.bankAccountHolderKana ?? ""}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* 仕入日 */}
            <div className="space-y-1">
              <Label className="text-xs text-slate-600 font-medium">仕入日 <span className="text-red-500">*</span></Label>
              <DateInput
                value={purchaseDate}
                onChange={e => setPurchaseDate(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>

          {/* ── 詳細設定（折りたたみ）── */}
          <details className="mt-3 group">
            <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-400 hover:text-slate-600 select-none py-1">
              <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
              詳細設定
              {(orderNumber || paymentDueDate || isDraft || taxCalcType !== "外税明細単位") && (
                <span className="ml-1 text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full">設定あり</span>
              )}
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 mt-3 pt-3 border-t border-slate-100">
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

              {/* 支払予定日 */}
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">支払予定日</Label>
                <DateInput
                  value={paymentDueDate}
                  onChange={e => setPaymentDueDate(e.target.value)}
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

              {/* チェックボックス群 */}
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
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
          </details>
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
                  <th className="px-3 py-2 text-left w-32 font-medium">工種</th>
                  <th className="px-3 py-2 text-left font-medium">品名・摘要</th>
                  <th className="px-3 py-2 text-right w-24 font-medium">数量</th>
                  <th className="px-3 py-2 text-center w-14 font-medium">単位</th>
                  <th className="px-3 py-2 text-right w-28 font-medium">単価</th>
                  <th className="px-3 py-2 text-right w-28 font-medium">金額</th>
                  <th className="px-3 py-2 text-center w-24 font-medium">消費税率</th>
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
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {/* 工種（科目の隣・検索可） */}
                      <td className="px-2 py-1.5">
                        <WorkTypeSelect
                          value={row.workTypeCode}
                          onChange={code => handleRowChange(idx, "workTypeCode", code)}
                          workTypes={workTypes}
                        />
                      </td>
                      {/* 品名・摘要 */}
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1 mb-1">
                          <ItemNameInput
                            vendorId={vendorId}
                            value={row.productName}
                            onChange={v => handleRowChange(idx, "productName", v)}
                            onSelect={(sel: UnitPriceSelection) => applyUnitPrice(idx, sel)}
                            placeholder="品名"
                            className="h-8 text-xs flex-1"
                          />
                          {vendorId && vendorId !== "none" && (
                          <>
                          <UnitPricePicker
                            vendorId={vendorId}
                            initialWorkTypeCode={row.workTypeCode}
                            onSelect={(sel: UnitPriceSelection) => applyUnitPrice(idx, sel)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1 text-xs h-7 px-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50 shrink-0"
                            title="この品名・単価を単価マスタに新規登録"
                            disabled={registeringRow === row.id || !row.productName.trim() || !row.unitPrice}
                            onClick={() => handleRegisterUnitPrice(row)}
                          >
                            {registeringRow === row.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Plus className="w-3 h-3" />}
                            単価登録
                          </Button>
                          </>
                          )}
                        </div>
                        <Input
                          value={row.spec}
                          onChange={e => handleRowChange(idx, "spec", e.target.value)}
                          placeholder="仕様・摘要"
                          className="h-7 text-xs text-slate-500"
                        />
                      </td>
                      {/* 数量 */}
                      <td className="px-2 py-1.5">
                        <NumberInput
                          ref={el => { quantityRefs.current[idx] = el; }}
                          value={row.quantity}
                          onChange={v => handleRowChange(idx, "quantity", v)}
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
                        <NumberInput
                          value={row.unitPrice}
                          onChange={v => handleRowChange(idx, "unitPrice", v)}
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
                      {/* 複製・削除 */}
                      <td className="px-1 py-1.5 text-center">
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => duplicateRow(idx)}
                            title="行を複製"
                            className="p-1 rounded text-slate-300 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRow(idx)}
                            title="行を削除"
                            className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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

      {/* ── 仕入伝票一覧 ── */}
      <div className="mt-8 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-teal-700" />
            <h2 className="text-base font-bold text-slate-800">仕入伝票一覧</h2>
            {invoiceListData && (
              <span className="text-xs text-slate-500">{invoiceListData.total}件</span>
            )}
          </div>
        </div>

        {/* フィルター */}
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">工事</Label>
            <Select value={filterInvoiceProject} onValueChange={setFilterInvoiceProject}>
              <SelectTrigger className="w-56 text-sm h-8">
                <SelectValue placeholder="すべての工事" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">すべての工事</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.projectCode} {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">ステータス</Label>
            <Select value={filterInvoiceStatus} onValueChange={setFilterInvoiceStatus}>
              <SelectTrigger className="w-36 text-sm h-8">
                <SelectValue placeholder="すべて" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">すべて</SelectItem>
                {Object.entries(INVOICE_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* テーブル */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 text-xs">
                <TableHead className="font-medium">伝票番号</TableHead>
                <TableHead className="font-medium">工事</TableHead>
                <TableHead className="font-medium">仕入先</TableHead>
                <TableHead className="font-medium">仕入日</TableHead>
                <TableHead className="font-medium">支払予定日</TableHead>
                <TableHead className="font-medium">状態</TableHead>
                <TableHead className="font-medium text-right">合計金額</TableHead>
                <TableHead className="font-medium text-center w-16">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoiceListLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-slate-400">読み込み中...</TableCell>
                </TableRow>
              ) : invoiceList.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-slate-400">
                    仕入伝票がありません。上のフォームから登録してください。
                  </TableCell>
                </TableRow>
              ) : invoiceList.map((inv) => (
                <TableRow key={inv.id} data-row-id={inv.id} className={cn("hover:bg-slate-50/60", isNew(inv.id) && "highlight-new")}>
                  <TableCell className="font-mono text-sm font-medium">
                    <Link
                      href={`/purchases?id=${inv.id}`}
                      className="text-teal-700 hover:text-teal-900 hover:underline flex items-center gap-1"
                    >
                      {inv.voucherNumber}
                      <Pencil className="w-3 h-3 opacity-50" />
                    </Link>
                    {inv.isProvisional && (
                      <Badge variant="outline" className="mt-1 text-[10px] text-amber-600 border-amber-400 bg-amber-50">仮</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{inv.projectCode}</div>
                    <div className="text-xs text-slate-500 truncate max-w-[160px]">{inv.projectName}</div>
                  </TableCell>
                  <TableCell className="text-sm">{inv.vendorName}</TableCell>
                  <TableCell className="text-sm text-slate-600">{inv.purchaseDate}</TableCell>
                  <TableCell className="text-sm text-slate-500">{inv.paymentDueDate ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${INVOICE_STATUS_COLORS[inv.status] ?? ""}`}>
                      {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-sm">
                    {inv.totalAmount.toLocaleString("ja-JP", { style: "currency", currency: "JPY" })}
                  </TableCell>
                  <TableCell className="text-center">
                    {(inv.status === "paid" || inv.status === "assessed") ? (
                      <span title="支払済・査定済は削除できません" className="inline-flex">
                        <Trash2 className="w-4 h-4 text-slate-200 cursor-not-allowed" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDeleteInvoice(inv)}
                        disabled={deletingInvoiceId === inv.id}
                        title="この仕入伝票を削除"
                        className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {deletingInvoiceId === inv.id
                          ? <span className="inline-block w-4 h-4 animate-spin">⏳</span>
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── 注文書取込モーダル ── */}
      <Dialog open={importPOOpen} onOpenChange={setImportPOOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              注文書から仕入伝票を作成
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 mb-3">
            発注済・一部納品の注文書から仕入伝票を作成します。未納品数量が自動的に取り込まれます。
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
                    取込可能な注文書がありません（発注済または一部納品のものが対象です）
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
