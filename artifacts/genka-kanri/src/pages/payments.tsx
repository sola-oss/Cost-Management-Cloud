import { useState } from "react";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CreditCard, Plus, Save, Loader2, CheckCircle2, Clock, AlertCircle, RefreshCw, Trash2, RotateCcw,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";

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
  invoiceNumber: string | null;
  notes: string | null;
  createdAt: string;
}

interface PaymentsResponse {
  items: PaymentItem[];
  total: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
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

function useCreatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      projectId: number;
      vendor: string;
      description: string;
      amount: number;
      dueDate?: string;
      invoiceNumber?: string;
      notes?: string;
    }) => {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create payment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
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

const newPaymentSchema = z.object({
  projectId: z.coerce.number().min(1, "工事を選択してください"),
  vendor: z.string().min(1, "支払先は必須です"),
  description: z.string().min(1, "内容は必須です"),
  amount: z.coerce.number().min(1, "金額は1以上である必要があります"),
  dueDate: z.string().optional(),
  invoiceNumber: z.string().optional(),
  notes: z.string().optional(),
});

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

// ─── メインページ ──────────────────────────────────────────────────────────────

export default function Payments() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const { data: payments, isLoading, refetch } = usePayments(statusFilter, projectFilter);
  const { data: projects } = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey() } });
  const createPayment = useCreatePayment();
  const revertPayment = useRevertPayment();
  const deletePayment = useDeletePayment();

  const form = useForm<z.infer<typeof newPaymentSchema>>({
    resolver: zodResolver(newPaymentSchema),
    defaultValues: {
      projectId: 0,
      vendor: "",
      description: "",
      amount: 0,
      dueDate: "",
      invoiceNumber: "",
      notes: "",
    },
  });

  function onAddSubmit(values: z.infer<typeof newPaymentSchema>) {
    createPayment.mutate(
      {
        projectId: values.projectId,
        vendor: values.vendor,
        description: values.description,
        amount: values.amount,
        dueDate: values.dueDate || undefined,
        invoiceNumber: values.invoiceNumber || undefined,
        notes: values.notes || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "登録しました", description: "支払予定を追加しました。" });
          setAddOpen(false);
          form.reset();
        },
        onError: () => {
          toast({ title: "エラー", description: "登録に失敗しました。", variant: "destructive" });
        },
      },
    );
  }

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

  const allItems = payments?.items ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items = overdueOnly
    ? allItems.filter(
        (i) => i.status === "pending" && i.dueDate && new Date(i.dueDate) < today
      )
    : allItems;

  const dueSoonCount = allItems.filter((i) => {
    if (i.status !== "pending" || !i.dueDate) return false;
    const days = (new Date(i.dueDate).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 7;
  }).length;

  const overdueCount = allItems.filter((i) => {
    if (i.status !== "pending" || !i.dueDate) return false;
    return new Date(i.dueDate) < today;
  }).length;

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
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              支払登録
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>支払予定の登録</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onAddSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="projectId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事 <span className="text-destructive">*</span></FormLabel>
                      <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="工事を選択" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {projects?.items.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              <span className="font-mono text-xs text-slate-400 mr-2">{p.projectCode}</span>{p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="vendor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>支払先 <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input placeholder="例: 田中建設" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="invoiceNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>請求書番号</FormLabel>
                        <FormControl><Input placeholder="例: INV-001" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>内容 <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input placeholder="例: 3月分外注費" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>金額（円） <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input type="number" placeholder="0" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="dueDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>支払期日</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>キャンセル</Button>
                  <Button type="submit" disabled={createPayment.isPending}>
                    {createPayment.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    登録
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIサマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-none bg-slate-50">
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">支払総額</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-xl font-bold">{formatCurrency(payments?.totalAmount ?? 0)}</div>
            <div className="text-xs text-slate-400 mt-0.5">{items.length} 件</div>
          </CardContent>
        </Card>
        <Card className="border-none bg-amber-50">
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-amber-600 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" />未払
            </CardTitle>
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
            <CardTitle className="text-xs text-emerald-600 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />支払済
            </CardTitle>
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
            <CardTitle className="text-xs text-slate-500 font-medium">支払率</CardTitle>
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
              {/* ステータスフィルタ */}
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
              {/* 期日超過フィルタ */}
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
              {/* 工事フィルタ */}
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
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
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
                      <TableCell colSpan={8}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-slate-500">
                      支払記録がありません。「支払登録」から追加してください。
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const isOverdue =
                      item.status === "pending" && item.dueDate && new Date(item.dueDate) < new Date();
                    const isDueSoon =
                      item.status === "pending" &&
                      item.dueDate &&
                      !isOverdue &&
                      (new Date(item.dueDate).getTime() - Date.now()) / 86400000 <= 7;

                    return (
                      <TableRow
                        key={item.id}
                        className={`hover:bg-slate-50/50 ${isOverdue ? "bg-red-50/50" : ""}`}
                      >
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <StatusBadge status={item.status} />
                            {isOverdue && (
                              <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300 gap-1 text-xs w-fit">
                                <AlertCircle className="w-3 h-3" />
                                期日超過
                              </Badge>
                            )}
                            {isDueSoon && !isOverdue && (
                              <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200 gap-1 text-xs w-fit">
                                <Clock className="w-3 h-3" />
                                今週期限
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
                          {item.description}
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
                              {new Date(item.dueDate).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                              {isOverdue && " ⚠️"}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.paidDate ? (
                            <span className="text-sm text-emerald-700">
                              {new Date(item.paidDate).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
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
    </div>
  );
}
