import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Pencil, Trash2, RefreshCw, CheckCircle2, AlertCircle, MinusCircle, ArrowDownUp } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── 型定義 ──────────────────────────────────────────────────────────────────
interface VendorInvoice {
  id: number;
  vendorId: number;
  vendorName: string;
  projectId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  periodYear: number;
  periodMonth: number;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  status: string;
}

interface VendorItem {
  id: number;
  name: string;
  groupName?: string;
}

interface ReconciliationItem {
  vendorId: number;
  vendorName: string;
  purchaseInputTotal: number;
  invoiceTotal: number;
  difference: number;
}

interface FormState {
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  periodYear: string;
  periodMonth: string;
  amount: string;
  taxRate: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  vendorId: "",
  invoiceNumber: "",
  invoiceDate: "",
  periodYear: String(new Date().getFullYear()),
  periodMonth: String(new Date().getMonth() + 1),
  amount: "",
  taxRate: "10",
  notes: "",
};

const STATUS_LABELS: Record<string, string> = { pending: "未確認", confirmed: "確認済" };
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

function fmt(n: number): string {
  return n.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
}

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// ── hooks ───────────────────────────────────────────────────────────────────
function useVendors() {
  return useQuery<{ items: VendorItem[] }>({
    queryKey: ["/api/vendors"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/vendors`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}

function useVendorInvoices(vendorId: string, year: string, month: string) {
  const params = new URLSearchParams();
  if (vendorId !== "__all__") params.set("vendorId", vendorId);
  if (year !== "__all__") params.set("year", year);
  if (month !== "__all__") params.set("month", month);
  return useQuery<{ items: VendorInvoice[]; total: number }>({
    queryKey: ["/api/vendor-invoices", vendorId, year, month],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/vendor-invoices?${params.toString()}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}

function useReconciliation(year: number, month: number, enabled: boolean) {
  return useQuery<{ year: number; month: number; items: ReconciliationItem[] }>({
    queryKey: ["/api/vendor-invoices/reconciliation", year, month],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/vendor-invoices/reconciliation?year=${year}&month=${month}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled,
  });
}

// ── 登録・編集ダイアログ ────────────────────────────────────────────────────
function InvoiceDialog({
  open, onClose, editTarget, vendors,
}: {
  open: boolean;
  onClose: () => void;
  editTarget: VendorInvoice | null;
  vendors: VendorItem[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = editTarget !== null;

  const [form, setForm] = useState<FormState>(() =>
    editTarget
      ? {
          vendorId: String(editTarget.vendorId),
          invoiceNumber: editTarget.invoiceNumber ?? "",
          invoiceDate: editTarget.invoiceDate,
          periodYear: String(editTarget.periodYear),
          periodMonth: String(editTarget.periodMonth),
          amount: String(editTarget.amount),
          taxRate: editTarget.taxAmount > 0
            ? String(Math.round((editTarget.taxAmount / editTarget.amount) * 100))
            : "10",
          notes: editTarget.notes ?? "",
        }
      : { ...EMPTY_FORM }
  );

  const amountNum = parseFloat(form.amount) || 0;
  const taxRateNum = parseFloat(form.taxRate) || 0;
  const taxAmountCalc = Math.round(amountNum * taxRateNum / 100);
  const totalCalc = amountNum + taxAmountCalc;

  const set = (key: keyof FormState, val: string) => setForm(f => ({ ...f, [key]: val }));

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        vendorId: form.vendorId,
        invoiceNumber: form.invoiceNumber || null,
        invoiceDate: form.invoiceDate,
        periodYear: parseInt(form.periodYear),
        periodMonth: parseInt(form.periodMonth),
        amount: amountNum,
        taxRate: taxRateNum,
        notes: form.notes || null,
      };
      const url = isEdit ? `${BASE}/api/vendor-invoices/${editTarget!.id}` : `${BASE}/api/vendor-invoices`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "登録に失敗しました");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vendor-invoices"] });
      toast({ title: isEdit ? "請求書を更新しました" : "請求書を登録しました" });
      onClose();
    },
    onError: (e: Error) => {
      toast({ title: "エラー", description: e.message, variant: "destructive" });
    },
  });

  const isValid = form.vendorId && form.invoiceDate && form.periodYear && form.periodMonth && amountNum > 0;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "請求書を編集" : "仕入先請求書を登録"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-sm">仕入先 <span className="text-red-500">*</span></Label>
            <Select value={form.vendorId} onValueChange={v => set("vendorId", v)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="仕入先を選択" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map(v => (
                  <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-sm">請求書番号</Label>
            <Input
              className="h-9"
              placeholder="例: INV-2026-001"
              value={form.invoiceNumber}
              onChange={e => set("invoiceNumber", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">請求日 <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                className="h-9"
                value={form.invoiceDate}
                onChange={e => set("invoiceDate", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">対象年月 <span className="text-red-500">*</span></Label>
              <div className="flex gap-1">
                <Select value={form.periodYear} onValueChange={v => set("periodYear", v)}>
                  <SelectTrigger className="h-9 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}年</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={form.periodMonth} onValueChange={v => set("periodMonth", v)}>
                  <SelectTrigger className="h-9 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map(m => <SelectItem key={m} value={String(m)}>{m}月</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">税抜金額 <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                className="h-9"
                placeholder="0"
                value={form.amount}
                onChange={e => set("amount", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">税率</Label>
              <Select value={form.taxRate} onValueChange={v => set("taxRate", v)}>
                <SelectTrigger className="h-9">
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

          {amountNum > 0 && (
            <div className="bg-slate-50 rounded-md p-3 text-sm space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>税抜金額</span><span>{fmt(amountNum)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>消費税（{taxRateNum}%）</span><span>{fmt(taxAmountCalc)}</span>
              </div>
              <div className="flex justify-between font-bold border-t pt-1 mt-1">
                <span>税込合計</span><span>{fmt(totalCalc)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-sm">メモ</Label>
            <Textarea
              className="text-sm resize-none"
              rows={2}
              placeholder="備考を入力"
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>キャンセル</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!isValid || mutation.isPending}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            {mutation.isPending ? "保存中..." : isEdit ? "更新" : "登録"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 突合確認表タブ ───────────────────────────────────────────────────────────
function ReconciliationTab() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [enabled, setEnabled] = useState(false);

  const { data, isLoading, refetch } = useReconciliation(year, month, enabled);

  const handleRun = () => {
    if (enabled) {
      refetch();
    } else {
      setEnabled(true);
    }
  };

  const items = data?.items ?? [];
  const totalCost = items.reduce((s, r) => s + r.purchaseInputTotal, 0);
  const totalInvoice = items.reduce((s, r) => s + r.invoiceTotal, 0);
  const totalDiff = totalInvoice - totalCost;
  const matchCount = items.filter(r => r.difference === 0).length;
  const diffCount = items.filter(r => r.difference !== 0).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">対象年</Label>
              <Select value={String(year)} onValueChange={v => { setYear(parseInt(v)); setEnabled(false); }}>
                <SelectTrigger className="w-28 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}年</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">対象月</Label>
              <Select value={String(month)} onValueChange={v => { setMonth(parseInt(v)); setEnabled(false); }}>
                <SelectTrigger className="w-24 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map(m => <SelectItem key={m} value={String(m)}>{m}月</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleRun}
              disabled={isLoading}
              className="h-8 bg-teal-600 hover:bg-teal-700 text-white text-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "集計中..." : "集計実行"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {enabled && !isLoading && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "仕入先数", value: items.length + "社", sub: "" },
              { label: "一致", value: matchCount + "社", sub: "", color: "text-emerald-600" },
              { label: "差異あり", value: diffCount + "社", sub: "", color: "text-red-600" },
              { label: "総差異額", value: fmt(totalDiff), sub: "", color: totalDiff === 0 ? "text-emerald-600" : "text-red-600" },
            ].map(kpi => (
              <Card key={kpi.label}>
                <CardContent className="p-4">
                  <div className="text-xs text-slate-500">{kpi.label}</div>
                  <div className={`text-xl font-bold mt-1 ${kpi.color ?? ""}`}>{kpi.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 突合テーブル */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm text-slate-700">
                {year}年{month}月 突合確認表
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {items.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  対象期間に仕入入力・仕入先請求書がありません
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 text-xs">
                      <TableHead className="font-medium">仕入先</TableHead>
                      <TableHead className="font-medium text-right">仕入入力合計</TableHead>
                      <TableHead className="font-medium text-right">請求金額合計</TableHead>
                      <TableHead className="font-medium text-right">差異</TableHead>
                      <TableHead className="font-medium text-center">状態</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(item => {
                      const isMatch = item.difference === 0;
                      const isOver = item.difference > 0;
                      return (
                        <TableRow
                          key={item.vendorId}
                          className={
                            isMatch
                              ? "bg-slate-50/40 text-slate-400"
                              : "bg-red-50/30"
                          }
                        >
                          <TableCell className={`text-sm font-medium ${isMatch ? "text-slate-400" : "text-slate-800"}`}>
                            {item.vendorName}
                          </TableCell>
                          <TableCell className={`text-right text-sm font-mono ${isMatch ? "text-slate-400" : ""}`}>
                            {fmt(item.purchaseInputTotal)}
                          </TableCell>
                          <TableCell className={`text-right text-sm font-mono ${isMatch ? "text-slate-400" : ""}`}>
                            {item.invoiceTotal > 0 ? fmt(item.invoiceTotal) : <span className="text-slate-300">—</span>}
                          </TableCell>
                          <TableCell className={`text-right text-sm font-mono font-bold ${
                            isMatch ? "text-slate-300" : isOver ? "text-red-600" : "text-amber-600"
                          }`}>
                            {isMatch ? "±0" : (isOver ? "+" : "") + fmt(item.difference)}
                          </TableCell>
                          <TableCell className="text-center">
                            {isMatch ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                                <CheckCircle2 className="w-3.5 h-3.5" />一致
                              </span>
                            ) : item.invoiceTotal === 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                <MinusCircle className="w-3.5 h-3.5" />未登録
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-red-600">
                                <AlertCircle className="w-3.5 h-3.5" />差異
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* 合計行 */}
                    <TableRow className="bg-slate-100 border-t-2 font-bold text-sm">
                      <TableCell>合計</TableCell>
                      <TableCell className="text-right font-mono">{fmt(totalCost)}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(totalInvoice)}</TableCell>
                      <TableCell className={`text-right font-mono ${totalDiff === 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {totalDiff === 0 ? "±0" : (totalDiff > 0 ? "+" : "") + fmt(totalDiff)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!enabled && (
        <div className="text-center py-16 text-slate-400 text-sm">
          年月を選択して「集計実行」をクリックすると突合結果が表示されます
        </div>
      )}
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────────────────────────
export default function VendorInvoices() {
  const [filterVendor, setFilterVendor] = useState("__all__");
  const [filterYear, setFilterYear] = useState("__all__");
  const [filterMonth, setFilterMonth] = useState("__all__");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VendorInvoice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VendorInvoice | null>(null);

  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: vendorsData } = useVendors();
  const vendors = vendorsData?.items ?? [];
  const { data, isLoading } = useVendorInvoices(filterVendor, filterYear, filterMonth);
  const invoices = data?.items ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/vendor-invoices/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("削除に失敗しました");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vendor-invoices"] });
      toast({ title: "請求書を削除しました" });
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "エラー", description: "削除に失敗しました", variant: "destructive" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/vendor-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed" }),
      });
      if (!res.ok) throw new Error("確認済にできませんでした");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vendor-invoices"] });
      toast({ title: "確認済にしました" });
    },
  });

  const openCreate = () => { setEditTarget(null); setDialogOpen(true); };
  const openEdit = (inv: VendorInvoice) => { setEditTarget(inv); setDialogOpen(true); };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArrowDownUp className="w-5 h-5 text-teal-700" />
          <h1 className="text-xl font-bold text-slate-900">仕入先請求書</h1>
          {data && (
            <span className="text-sm text-slate-500">{data.total}件</span>
          )}
        </div>
        <Button
          size="sm"
          className="bg-teal-600 hover:bg-teal-700 text-white"
          onClick={openCreate}
        >
          <Plus className="w-4 h-4 mr-1" />
          請求書を登録
        </Button>
      </div>

      <Tabs defaultValue="list">
        <TabsList className="h-9">
          <TabsTrigger value="list" className="text-sm">請求書一覧</TabsTrigger>
          <TabsTrigger value="reconciliation" className="text-sm">突合確認表</TabsTrigger>
        </TabsList>

        {/* ── 請求書一覧タブ ── */}
        <TabsContent value="list" className="space-y-4 mt-4">
          {/* フィルター */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex flex-wrap gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">仕入先</Label>
                  <Select value={filterVendor} onValueChange={setFilterVendor}>
                    <SelectTrigger className="w-48 text-sm h-8">
                      <SelectValue placeholder="すべての仕入先" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">すべての仕入先</SelectItem>
                      {vendors.map(v => (
                        <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">対象年</Label>
                  <Select value={filterYear} onValueChange={setFilterYear}>
                    <SelectTrigger className="w-28 text-sm h-8">
                      <SelectValue placeholder="すべて" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">すべて</SelectItem>
                      {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}年</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">対象月</Label>
                  <Select value={filterMonth} onValueChange={setFilterMonth}>
                    <SelectTrigger className="w-24 text-sm h-8">
                      <SelectValue placeholder="すべて" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">すべて</SelectItem>
                      {MONTHS.map(m => <SelectItem key={m} value={String(m)}>{m}月</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 一覧テーブル */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 text-xs">
                    <TableHead className="font-medium">仕入先</TableHead>
                    <TableHead className="font-medium">請求書番号</TableHead>
                    <TableHead className="font-medium">対象年月</TableHead>
                    <TableHead className="font-medium">請求日</TableHead>
                    <TableHead className="font-medium text-right">税抜金額</TableHead>
                    <TableHead className="font-medium text-right">税込合計</TableHead>
                    <TableHead className="font-medium text-center">ステータス</TableHead>
                    <TableHead className="font-medium text-center w-28">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-slate-400">読み込み中...</TableCell>
                    </TableRow>
                  ) : invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-slate-400">
                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <div>仕入先請求書がありません</div>
                        <div className="text-xs mt-1">「請求書を登録」から登録してください</div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    invoices.map(inv => (
                      <TableRow key={inv.id} className="hover:bg-slate-50/60">
                        <TableCell className="font-medium text-sm">{inv.vendorName}</TableCell>
                        <TableCell className="text-sm font-mono text-slate-600">
                          {inv.invoiceNumber ?? <span className="text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {inv.periodYear}年{inv.periodMonth}月
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{inv.invoiceDate}</TableCell>
                        <TableCell className="text-right text-sm font-mono">{fmt(inv.amount)}</TableCell>
                        <TableCell className="text-right text-sm font-mono font-medium">{fmt(inv.totalAmount)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-xs ${STATUS_COLORS[inv.status] ?? ""}`}>
                            {STATUS_LABELS[inv.status] ?? inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            {inv.status === "pending" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                title="確認済にする"
                                onClick={() => confirmMutation.mutate(inv.id)}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-500 hover:text-slate-700"
                              onClick={() => openEdit(inv)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
                              onClick={() => setDeleteTarget(inv)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 突合確認表タブ ── */}
        <TabsContent value="reconciliation" className="mt-4">
          <ReconciliationTab />
        </TabsContent>
      </Tabs>

      {/* 登録/編集ダイアログ */}
      {dialogOpen && (
        <InvoiceDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          editTarget={editTarget}
          vendors={vendors}
        />
      )}

      {/* 削除確認ダイアログ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>請求書を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.vendorName} の{deleteTarget?.periodYear}年{deleteTarget?.periodMonth}月分請求書を削除します。
              この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
