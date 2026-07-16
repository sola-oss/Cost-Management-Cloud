import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CreditCard, Save, Loader2, CheckCircle2, Clock, AlertCircle,
  RefreshCw, Trash2, RotateCcw, Upload, AlertTriangle, ExternalLink, History,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useVendors } from "@/hooks/use-vendors";
import { useCompanySettings } from "@/hooks/use-company-settings";

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface PaymentItem {
  id: number;
  projectId: number;
  projectCode: string;
  projectName: string;
  vendor: string;
  description: string;
  amount: number;
  paidAmount: number | null;
  dueDate: string | null;
  paidDate: string | null;
  status: "pending" | "paid" | "partial";
  source: "manual" | "assessment";
  invoiceNumber: string | null;
  notes: string | null;
  createdAt: string;
  lastExportedAt: string | null;
}

interface PaymentsResponse {
  items: PaymentItem[];
  total: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
}

interface CompanySettings {
  consignorCode: string | null;
  companyNameKana: string | null;
  bankCode: string | null;
  bankBranchCode: string | null;
  bankAccountType: string | null;
  bankAccountNumber: string | null;
  [key: string]: unknown;
}

interface VendorItem {
  id: number;
  name: string;
  bankCode: string | null;
  bankBranchCode: string | null;
  bankAccountType: string | null;
  bankAccountNumber: string | null;
  bankAccountHolderKana: string | null;
  [key: string]: unknown;
}

// ─── 日付ユーティリティ ───────────────────────────────────────────────────────

function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getTodayStr() {
  return formatDateLocal(new Date());
}

function getWeekEndStr() {
  const d = new Date();
  const dow = d.getDay();
  const diff = (7 - dow) % 7;
  d.setDate(d.getDate() + diff);
  return formatDateLocal(d);
}

function getMonthEndStr() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return formatDateLocal(last);
}

// ─── API フック ─────────────────────────────────────────────────────────────

function usePayments(statusFilter?: string, projectFilter?: string) {
  return useQuery({
    queryKey: ["/api/payments", statusFilter, projectFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (projectFilter && projectFilter !== "all") params.set("projectId", projectFilter);
      const res = await fetch(`/api/payments?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch payments");
      return res.json() as Promise<PaymentsResponse>;
    },
  });
}


function useMarkAsPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, paidDate, paidAmount }: { id: number; paidDate?: string; paidAmount?: number }) => {
      const res = await fetch(`/api/payments/${id}/pay`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidDate, paidAmount }),
      });
      if (!res.ok) throw new Error("Failed to mark as paid");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    },
  });
}

function useRevertPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/payments/${id}/unpay`, { method: "PATCH" });
      if (!res.ok) throw new Error("Failed to revert payment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    },
  });
}

function useDeletePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/payments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete payment");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    },
  });
}

// ─── フォームスキーマ ────────────────────────────────────────────────────────

// ─── ステータスバッジ ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PaymentItem["status"] }) {
  const config = {
    pending: { label: "未払", className: "bg-amber-100 text-amber-700 border-amber-200", icon: Clock },
    paid: { label: "支払済", className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
    partial: { label: "一部払", className: "bg-blue-100 text-blue-700 border-blue-200", icon: AlertCircle },
  };
  const { label, className, icon: Icon } = config[status];
  return (
    <Badge variant="outline" className={`${className} gap-1 text-xs`}>
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
}

// ─── 支払済マークダイアログ ────────────────────────────────────────────────────

function MarkPaidDialog({ payment, onPaid }: { payment: PaymentItem; onPaid: () => void }) {
  const [open, setOpen] = useState(false);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().split("T")[0]);
  const [paidAmount, setPaidAmount] = useState(String(payment.amount));
  const markAsPaid = useMarkAsPaid();
  const { toast } = useToast();

  const handlePay = async () => {
    try {
      await markAsPaid.mutateAsync({ id: payment.id, paidDate, paidAmount: Number(paidAmount) });
      toast({ title: "支払済にしました" });
      setOpen(false);
      onPaid();
    } catch {
      toast({ title: "エラー", description: "更新に失敗しました", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50">
          <CheckCircle2 className="w-3 h-3" />
          支払済
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>支払処理</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-slate-600 bg-slate-50 rounded p-3">
            <div className="font-medium">{payment.vendor}</div>
            <div className="text-slate-500">{payment.description}</div>
            <div className="font-bold text-slate-900 mt-1">{formatCurrency(payment.amount)}</div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-slate-700">支払日</label>
              <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">支払金額（円）</label>
              <Input
                type="number"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
          <Button onClick={handlePay} disabled={markAsPaid.isPending}>
            {markAsPaid.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            確定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 全銀データ出力ダイアログ ─────────────────────────────────────────────────

interface VendorWarning {
  vendorName: string;
  missingFields: string[];
}

interface ZenginDialogProps {
  open: boolean;
  onClose: () => void;
  selectedItems: PaymentItem[];
  vendors: VendorItem[];
  defaultDate: string;
}

function ZenginExportDialog({ open, onClose, selectedItems, vendors, defaultDate }: ZenginDialogProps) {
  const today = getTodayStr();
  const [executionDate, setExecutionDate] = useState(defaultDate >= today ? defaultDate : today);
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const totalAmount = selectedItems.reduce((s, i) => s + i.amount - (i.paidAmount ?? 0), 0);

  const vendorWarnings = useMemo<VendorWarning[]>(() => {
    const seen = new Set<string>();
    const warnings: VendorWarning[] = [];
    for (const item of selectedItems) {
      if (seen.has(item.vendor)) continue;
      seen.add(item.vendor);
      const vendor = vendors.find((v) => v.name === item.vendor);
      if (!vendor) {
        warnings.push({ vendorName: item.vendor, missingFields: ["仕入先マスタ未登録"] });
      } else {
        const hasIncomplete =
          !vendor.bankCode ||
          !vendor.bankBranchCode ||
          !vendor.bankAccountType ||
          !vendor.bankAccountNumber ||
          !vendor.bankAccountHolderKana;
        if (hasIncomplete) {
          warnings.push({ vendorName: item.vendor, missingFields: ["口座情報未入力"] });
        }
      }
    }
    return warnings;
  }, [selectedItems, vendors]);

  const handleExport = async () => {
    if (!executionDate || executionDate < today) {
      toast({ title: "取組日エラー", description: "取組日は今日以降の日付を指定してください", variant: "destructive" });
      return;
    }
    setIsExporting(true);
    try {
      const res = await fetch("/api/payments/zengin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentIds: selectedItems.map((i) => i.id),
          executionDate,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "不明なエラー" }));
        toast({ title: "出力エラー", description: err.message ?? "振込データの生成に失敗しました", variant: "destructive" });
        return;
      }

      // ファイル名をレスポンスヘッダから取得
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `furikomi_${Date.now()}.txt`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: "振込データを出力しました",
        description: `ファイル名：${filename}（${selectedItems.length}件 / ${formatCurrency(totalAmount)}）`,
        duration: 8000,
      });
      onClose();
    } catch {
      toast({ title: "出力エラー", description: "通信エラーが発生しました", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            振込データ出力
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 取組日 */}
          <div>
            <label className="text-sm font-medium text-slate-700">
              取組日 <span className="text-destructive">*</span>
            </label>
            <Input
              type="date"
              value={executionDate}
              min={today}
              onChange={(e) => setExecutionDate(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-slate-400 mt-1">今日以降の日付を指定してください</p>
          </div>

          {/* 出力対象サマリー */}
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <div className="font-medium text-slate-700">出力対象</div>
            <div className="text-slate-900 mt-1">
              <span className="font-bold text-lg">{selectedItems.length}</span>
              <span className="text-slate-500 ml-1">件 / </span>
              <span className="font-bold">{formatCurrency(totalAmount)}</span>
              <span className="text-slate-500 ml-1">を出力します</span>
            </div>
          </div>

          {/* 仕入先振込先情報の警告 */}
          {vendorWarnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-amber-800">振込先情報が不足している仕入先があります</div>
                  <div className="text-amber-700 mt-1 text-xs">
                    以下の仕入先は振込先情報が未入力のため、出力されたファイルは銀行で取り込めない可能性があります。
                  </div>
                  <ul className="mt-2 space-y-1">
                    {vendorWarnings.map((w) => (
                      <li key={w.vendorName} className="text-amber-700 text-xs">
                        ・<span className="font-medium">{w.vendorName}</span>
                        <span className="text-amber-600">（{w.missingFields.join("・")}未入力）</span>
                      </li>
                    ))}
                  </ul>
                  <div className="text-amber-600 text-xs mt-2">
                    このまま出力するか、仕入先マスタで口座情報を編集してください。
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            キャンセル
          </Button>
          <Button onClick={handleExport} disabled={isExporting || !executionDate || executionDate < today}>
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            出力
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── メインページ ──────────────────────────────────────────────────────────────


// ─── 振込データ出力履歴ダイアログ ─────────────────────────────────────────────

interface ZenginExportHistory {
  id: number;
  fileName: string;
  executionDate: string;
  paymentCount: number;
  totalAmount: number;
  exportedAt: string;
  payments: { id: number; vendorName: string; amount: number }[];
}

function ZenginHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/payments/zengin-exports"],
    queryFn: async () => {
      const res = await fetch("/api/payments/zengin-exports");
      if (!res.ok) throw new Error("Failed to fetch zengin exports");
      return res.json() as Promise<{ items: ZenginExportHistory[] }>;
    },
    enabled: open,
  });
  const items = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            振込データ出力履歴
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />読み込み中...
          </div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">
            出力履歴はまだありません。支払管理で支払を選択して「振込データを出力」すると記録されます。
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((e) => (
              <details key={e.id} className="border rounded-md group">
                <summary className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none hover:bg-slate-50 text-sm list-none [&::-webkit-details-marker]:hidden">
                  <svg className="w-3 h-3 shrink-0 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                  <span className="font-medium text-slate-700 whitespace-nowrap">
                    {new Date(e.exportedAt).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-slate-500 whitespace-nowrap">取組日 {e.executionDate}</span>
                  <span className="text-slate-500 whitespace-nowrap">{e.paymentCount}件</span>
                  <span className="font-bold text-slate-900 ml-auto whitespace-nowrap">{formatCurrency(e.totalAmount)}</span>
                </summary>
                <div className="px-3 pb-3 pt-1 border-t bg-slate-50/50">
                  <div className="text-xs text-slate-400 mb-2 font-mono">{e.fileName}</div>
                  <table className="w-full text-sm">
                    <tbody>
                      {e.payments.map((pmt) => (
                        <tr key={pmt.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-1 text-slate-700">{pmt.vendorName}</td>
                          <td className="py-1 text-right text-slate-900">{formatCurrency(pmt.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Payments() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [zenginOpen, setZenginOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data: payments, isLoading, refetch } = usePayments(statusFilter, projectFilter);
  const { data: projects } = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey() } });
  const { data: companySettings } = useCompanySettings<CompanySettings>();
  const { data: vendors = [] } = useVendors<VendorItem>();
  const revertPayment = useRevertPayment();
  const deletePayment = useDeletePayment();

  async function handleRevert(id: number) {
    try {
      await revertPayment.mutateAsync(id);
      toast({ title: "未払いに戻しました" });
    } catch {
      toast({ title: "エラー", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("この支払記録を削除してもよいですか？")) return;
    try {
      await deletePayment.mutateAsync(id);
      toast({ title: "削除しました" });
    } catch {
      toast({ title: "エラー", variant: "destructive" });
    }
  }

  const todayStr = getTodayStr();
  const today = new Date(todayStr);

  const allItems = payments?.items ?? [];

  const baseItems = overdueOnly
    ? allItems.filter((i) => i.status === "pending" && i.dueDate && i.dueDate < todayStr)
    : allItems;

  const items = useMemo(() => {
    return [...baseItems].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }, [baseItems]);

  const dueSoonCount = allItems.filter((i) => {
    if (i.status !== "pending" || !i.dueDate) return false;
    const days = (new Date(i.dueDate).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 7;
  }).length;

  const overdueCount = allItems.filter((i) => {
    if (i.status !== "pending" || !i.dueDate) return false;
    return i.dueDate < todayStr;
  }).length;

  const overdueAmount = allItems
    .filter((i) => i.status === "pending" && i.dueDate && i.dueDate < todayStr)
    .reduce((s, i) => s + i.amount, 0);

  // ─── チェックボックス関連 ──────────────────────────────────────────────────

  function isCheckable(item: PaymentItem) {
    return item.status === "pending" && !!item.vendor?.trim();
  }

  const checkableIds = useMemo(() => items.filter(isCheckable).map((i) => i.id), [items]);

  const allChecked = checkableIds.length > 0 && checkableIds.every((id) => selectedIds.has(id));
  const someChecked = checkableIds.some((id) => selectedIds.has(id));

  function toggleAll() {
    if (allChecked) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        checkableIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        checkableIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectByIds(ids: number[]) {
    setSelectedIds(new Set(ids));
  }

  function quickSelectThisWeek() {
    const weekEnd = getWeekEndStr();
    const ids = allItems
      .filter((i) => isCheckable(i) && i.dueDate && i.dueDate >= todayStr && i.dueDate <= weekEnd)
      .map((i) => i.id);
    selectByIds(ids);
  }

  function quickSelectThisMonth() {
    const monthEnd = getMonthEndStr();
    const ids = allItems
      .filter((i) => isCheckable(i) && i.dueDate && i.dueDate >= todayStr && i.dueDate <= monthEnd)
      .map((i) => i.id);
    selectByIds(ids);
  }

  function quickSelectOverdue() {
    const ids = allItems
      .filter((i) => isCheckable(i) && i.dueDate && i.dueDate < todayStr)
      .map((i) => i.id);
    selectByIds(ids);
  }

  function quickSelectAllPending() {
    const ids = allItems.filter((i) => isCheckable(i)).map((i) => i.id);
    selectByIds(ids);
  }

  const selectedItems = allItems.filter((i) => selectedIds.has(i.id));
  const selectedAmount = selectedItems.reduce((s, i) => s + i.amount, 0);

  // デフォルト取組日：選択行の最も早い支払期日（過去日なら今日）
  const defaultExecutionDate = useMemo(() => {
    const dueDates = selectedItems
      .map((i) => i.dueDate)
      .filter((d): d is string => !!d)
      .sort();
    if (dueDates.length === 0) return todayStr;
    const earliest = dueDates[0];
    return earliest >= todayStr ? earliest : todayStr;
  }, [selectedItems, todayStr]);

  function handleExportClick() {
    if (selectedIds.size === 0) return;

    // 会社設定の必須チェック
    if (companySettings) {
      const missingLabels: string[] = [];
      if (!companySettings.consignorCode) missingLabels.push("委託者コード");
      if (!companySettings.companyNameKana) missingLabels.push("会社名カナ");
      if (!companySettings.bankCode) missingLabels.push("銀行コード");
      if (!companySettings.bankBranchCode) missingLabels.push("支店コード");
      if (!companySettings.bankAccountType) missingLabels.push("口座種別");
      if (!companySettings.bankAccountNumber) missingLabels.push("口座番号");

      if (missingLabels.length > 0) {
        toast({
          title: "会社設定の振込元情報が未入力です",
          description: `未入力項目：${missingLabels.join("、")}。会社設定画面で入力してください。`,
          variant: "destructive",
          action: (
            <button
              className="flex items-center gap-1 text-xs underline whitespace-nowrap"
              onClick={() => setLocation("/settings")}
            >
              <ExternalLink className="w-3 h-3" />
              設定画面へ
            </button>
          ) as unknown as undefined,
        });
        return;
      }
    }

    setZenginOpen(true);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ヘッダー */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary" />
            支払管理
          </h1>
          <p className="text-sm text-slate-500 mt-1">外注・仕入先への支払状況を管理します。</p>
        </div>
      </div>

      {/* 期日超過警告バナー */}
      {overdueCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="text-sm">
            期日超過の支払が <strong>{overdueCount}件</strong> あります（合計 {formatCurrency(overdueAmount)}）。早急にご確認ください。
          </span>
        </div>
      )}

      {/* KPIサマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-none bg-slate-50">
          <CardHeader className="py-3 pb-1">
            <div className="text-xs text-slate-500 font-medium">支払総額</div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-xl font-bold">{formatCurrency(payments?.totalAmount ?? 0)}</div>
            <div className="text-xs text-slate-400 mt-0.5">{items.length} 件</div>
          </CardContent>
        </Card>
        <Card className="border-none bg-amber-50">
          <CardHeader className="py-3 pb-1">
            <div className="text-xs text-amber-600 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" />未払
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-xl font-bold text-amber-700">{formatCurrency(payments?.pendingAmount ?? 0)}</div>
            {overdueCount > 0 && (
              <div className="text-xs text-destructive mt-0.5 font-medium">{overdueCount}件が期限超過</div>
            )}
            {dueSoonCount > 0 && (
              <div className="text-xs text-amber-600 mt-0.5">{dueSoonCount}件が今週期限</div>
            )}
          </CardContent>
        </Card>
        <Card className="border-none bg-emerald-50">
          <CardHeader className="py-3 pb-1">
            <div className="text-xs text-emerald-600 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />支払済
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-xl font-bold text-emerald-700">{formatCurrency(payments?.paidAmount ?? 0)}</div>
            <div className="text-xs text-emerald-600 mt-0.5">
              {items.filter((i) => i.status === "paid").length} 件
            </div>
          </CardContent>
        </Card>
        <Card className="border-none bg-slate-50">
          <CardHeader className="py-3 pb-1">
            <div className="text-xs text-slate-500 font-medium">支払率</div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-xl font-bold">
              {payments?.totalAmount
                ? `${(((payments.paidAmount ?? 0) / payments.totalAmount) * 100).toFixed(1)}%`
                : "0.0%"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* フィルター + テーブル */}
      <Card>
        <CardHeader className="border-b py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2 flex-wrap">
              {[
                { value: "all", label: "すべて" },
                { value: "pending", label: "未払" },
                { value: "partial", label: "一部払" },
                { value: "paid", label: "支払済" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setStatusFilter(opt.value); setOverdueOnly(false); }}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    statusFilter === opt.value && !overdueOnly
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <button
                onClick={() => { setOverdueOnly(!overdueOnly); if (!overdueOnly) setStatusFilter("all"); }}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1 ${
                  overdueOnly
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-white text-red-600 border-red-300 hover:bg-red-50"
                }`}
              >
                <AlertCircle className="w-3 h-3" />
                期日超過{overdueCount > 0 && <span className={`ml-0.5 font-bold ${overdueOnly ? "text-white" : "text-red-600"}`}>（{overdueCount}）</span>}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="h-8 w-[160px] text-xs">
                  <SelectValue placeholder="工事で絞込" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全工事</SelectItem>
                  {projects?.items.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.projectCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* クイック選択ボタン + 選択サマリー */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t mt-2">
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-slate-400 self-center">振込対象を選択：</span>
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={quickSelectThisWeek}>
                今週支払い
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={quickSelectThisMonth}>
                今月支払い
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-red-600 border-red-200 hover:bg-red-50" onClick={quickSelectOverdue}>
                期日超過のみ
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-amber-700 border-amber-200 hover:bg-amber-50" onClick={quickSelectAllPending}>
                全未払
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                選択: <strong>{selectedIds.size}件</strong> / {formatCurrency(selectedAmount)}
              </span>
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={selectedIds.size === 0}
                onClick={handleExportClick}
              >
                <Upload className="w-3.5 h-3.5" />
                振込データを出力
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setHistoryOpen(true)}
              >
                <History className="w-3.5 h-3.5" />
                出力履歴
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={allChecked}
                      data-state={someChecked && !allChecked ? "indeterminate" : undefined}
                      onCheckedChange={toggleAll}
                      disabled={checkableIds.length === 0}
                      aria-label="全選択"
                    />
                  </TableHead>
                  <TableHead className="w-[100px]">状態</TableHead>
                  <TableHead>工事</TableHead>
                  <TableHead>支払先</TableHead>
                  <TableHead>内容</TableHead>
                  <TableHead className="text-right">支払金額</TableHead>
                  <TableHead className="w-[100px]">支払期日</TableHead>
                  <TableHead className="w-[100px]">支払日</TableHead>
                  <TableHead className="w-[140px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={9}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-slate-500">
                      支払記録がありません。仕入入力 → 支払査定 で支払予定が作成されます。
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const isOverdue = item.status === "pending" && !!item.dueDate && item.dueDate < todayStr;
                    const isToday = item.status === "pending" && item.dueDate === todayStr;
                    const isDueSoon =
                      item.status === "pending" &&
                      !!item.dueDate &&
                      !isOverdue &&
                      !isToday &&
                      (new Date(item.dueDate).getTime() - today.getTime()) / 86400000 <= 7;
                    const checkable = isCheckable(item);
                    const checked = selectedIds.has(item.id);

                    let rowBg = "";
                    if (isOverdue) rowBg = "bg-red-50 hover:bg-red-100";
                    else if (isToday) rowBg = "bg-yellow-50 hover:bg-yellow-100";
                    else rowBg = "hover:bg-slate-50/50";

                    return (
                      <TableRow key={item.id} className={rowBg}>
                        <TableCell className="pl-4">
                          {checkable ? (
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleOne(item.id)}
                              aria-label={`${item.vendor} を選択`}
                            />
                          ) : (
                            <span title={
                              item.status === "paid" ? "支払済の行は対象外です" :
                              item.status === "partial" ? "一部払の行は対象外です" :
                              !item.vendor?.trim() ? "仕入先が未設定です" : "対象外"
                            }>
                              <Checkbox checked={false} disabled aria-label="対象外" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <StatusBadge status={item.status} />
                            {isOverdue && (
                              <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300 gap-1 text-xs w-fit">
                                <AlertCircle className="w-3 h-3" />
                                期日超過
                              </Badge>
                            )}
                            {isDueSoon && (
                              <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200 gap-1 text-xs w-fit">
                                <Clock className="w-3 h-3" />
                                今週期限
                              </Badge>
                            )}
                            {item.lastExportedAt && (
                              <Badge
                                variant="outline"
                                className="bg-sky-50 text-sky-700 border-sky-200 gap-1 text-xs w-fit"
                                title={`振込データ出力済み: ${new Date(item.lastExportedAt).toLocaleString("ja-JP")}`}
                              >
                                <Upload className="w-3 h-3" />
                                出力済 {new Date(item.lastExportedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium truncate max-w-[120px]">{item.projectName}</div>
                          <div className="text-xs text-slate-400 font-mono">{item.projectCode}</div>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{item.vendor}</TableCell>
                        <TableCell className="text-sm text-slate-700">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.description}
                            {item.source === "assessment" && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-50 text-blue-600 border-blue-200">査定</Badge>
                            )}
                          </div>
                          {item.invoiceNumber && (
                            <div className="text-xs text-slate-400">{item.invoiceNumber}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold text-slate-900">
                          {formatCurrency(item.amount)}
                          {item.paidAmount && item.paidAmount < item.amount && (
                            <div className="text-xs text-slate-400">
                              支払済 {formatCurrency(item.paidAmount)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.dueDate ? (
                            <span
                              className={`text-sm ${
                                isOverdue
                                  ? "text-destructive font-bold"
                                  : isDueSoon
                                  ? "text-amber-600 font-medium"
                                  : "text-slate-600"
                              }`}
                            >
                              {new Date(item.dueDate + "T00:00:00").toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                              {isOverdue && " ⚠️"}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.paidDate ? (
                            <span className="text-sm text-emerald-700">
                              {new Date(item.paidDate + "T00:00:00").toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {item.status !== "paid" && (
                              <MarkPaidDialog payment={item} onPaid={() => refetch()} />
                            )}
                            {(item.status === "paid" || item.status === "partial") && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-slate-400 hover:text-amber-600"
                                onClick={() => handleRevert(item.id)}
                                title="未払いに戻す"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-slate-400 hover:text-destructive"
                              onClick={() => handleDelete(item.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 全銀データ出力ダイアログ */}
      <ZenginHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
      {zenginOpen && (
        <ZenginExportDialog
          open={zenginOpen}
          onClose={() => setZenginOpen(false)}
          selectedItems={selectedItems}
          vendors={vendors}
          defaultDate={defaultExecutionDate}
        />
      )}
    </div>
  );
}
