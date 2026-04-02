import { useState, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetProject, useUpdateProject,
  useGetProjectSummary,
  useListCostItems, useCreateCostItem, useUpdateCostItem, useDeleteCostItem,
  useGetBudgetVsActual,
  useListBudgetItems, useCreateBudgetItem, useUpdateBudgetItem, useDeleteBudgetItem,
  getGetProjectQueryKey, getGetProjectSummaryQueryKey,
  getListCostItemsQueryKey, getGetBudgetVsActualQueryKey,
  getListBudgetItemsQueryKey,
} from "@workspace/api-client-react";
import type { ProjectDetail } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  ArrowLeft, Edit, Plus, Save, X, AlertTriangle, CheckCircle, TrendingUp,
  FileText, Calculator, BarChart2, ClipboardList, Loader2, Trash2, Search, ExternalLink,
} from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const STATUS_LABELS: Record<string, string> = {
  planning: "計画中",
  active: "施工中",
  completed: "完工",
  suspended: "中断",
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-slate-100 text-slate-700 border-slate-200",
  active: "bg-orange-100 text-orange-700 border-orange-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  suspended: "bg-red-100 text-red-700 border-red-200",
};

const CATEGORIES = ["material", "labor", "subcontract", "expense"] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  material: "材料費",
  labor: "労務費",
  subcontract: "外注費",
  expense: "経費",
};

const CATEGORY_COLORS: Record<Category, string> = {
  material: "bg-blue-100 text-blue-700",
  labor: "bg-purple-100 text-purple-700",
  subcontract: "bg-orange-100 text-orange-700",
  expense: "bg-slate-100 text-slate-700",
};

// ─── Schemas ────────────────────────────────────────────────────────────────

const TAX_RATES = [0, 8, 10] as const;

const projectEditSchema = z.object({
  name: z.string().min(1, "工事名称は必須です"),
  shortName: z.string().optional(),
  clientName: z.string().min(1, "発注者名は必須です"),
  location: z.string().min(1, "工事場所は必須です"),
  contractAmount: z.coerce.number().min(0, "0以上の値を入力してください"),
  status: z.enum(["planning", "active", "completed", "suspended"]),
  startDate: z.string().min(1, "着工日は必須です"),
  endDate: z.string().min(1, "竣工予定日は必須です"),
  description: z.string().optional(),
  estimateNumber: z.string().optional(),
  orderType: z.string().optional(),
  overview: z.string().optional(),
  taxExcludedAmount: z.coerce.number().min(0).optional().or(z.literal("")),
  taxRate: z.coerce.number().optional().or(z.literal("")),
  taxAmount: z.coerce.number().optional().or(z.literal("")),
  taxIncludedAmount: z.coerce.number().optional().or(z.literal("")),
  department: z.string().optional(),
  salesStaff: z.string().optional(),
  siteManager: z.string().optional(),
  category1: z.string().optional(),
  category2: z.string().optional(),
  category3: z.string().optional(),
  orderDate: z.string().optional(),
  handoverDate: z.string().optional(),
  progressRate: z.coerce.number().min(0).max(100).optional().or(z.literal("")),
  recognitionBasis: z.string().optional(),
  publicPrivateType: z.string().optional(),
  clientCode: z.string().optional(),
  constructionHistoryType: z.string().optional(),
  constructionHistoryEngineer: z.string().optional(),
});

const costItemSchema = z.object({
  category: z.enum(["material", "labor", "subcontract", "expense"]),
  description: z.string().min(1, "摘要は必須です"),
  vendor: z.string().optional(),
  quantity: z.coerce.number().optional().or(z.literal("")),
  unit: z.string().optional(),
  unitPrice: z.coerce.number().optional().or(z.literal("")),
  amount: z.coerce.number().min(0, "金額は0以上である必要があります"),
  incurredDate: z.string().min(1, "発生日は必須です"),
  invoiceNumber: z.string().optional(),
  notes: z.string().optional(),
});

// ─── 工種マスタ hook ─────────────────────────────────────────────────────

type WorkTypeMasterItem = { id: number; code: string; name: string; constructionType: string };

function useWorkTypes() {
  const { data } = useQuery<WorkTypeMasterItem[]>({
    queryKey: ["/api/work-types"],
    queryFn: async () => {
      const res = await fetch("/api/work-types");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });
  return data ?? [];
}

// ─── 得意先マスタ hook ────────────────────────────────────────────────────

type ClientMasterItem = { id: number; clientCode: string; name: string; address: string | null; tel: string | null; contactName: string | null };

function useClients() {
  const { data } = useQuery<{ items: ClientMasterItem[] }>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients");
      if (!res.ok) return { items: [] };
      return res.json();
    },
    staleTime: 60_000,
  });
  return data?.items ?? [];
}

// ─── 実行予算タブ ─────────────────────────────────────────────────────────

type EditingRow = {
  workTypeCode: string;
  workTypeName: string;
  supplierName: string;
  contractAmount: string;
  initialBudget: string;
  revisedBudget: string;
};

function BudgetTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const workTypeMaster = useWorkTypes();

  const { data: budgetItemsData, isLoading } = useListBudgetItems(
    projectId,
    { query: { enabled: !!projectId, queryKey: getListBudgetItemsQueryKey(projectId) } },
  );

  const createBudgetItem = useCreateBudgetItem();
  const updateBudgetItem = useUpdateBudgetItem();
  const deleteBudgetItem = useDeleteBudgetItem();

  // Inline editing state per row: id -> editing values
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValues, setEditingValues] = useState<EditingRow>({
    workTypeCode: "", workTypeName: "", supplierName: "",
    contractAmount: "", initialBudget: "", revisedBudget: "",
  });

  // New row add state
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState<EditingRow>({
    workTypeCode: "", workTypeName: "", supplierName: "",
    contractAmount: "0", initialBudget: "0", revisedBudget: "0",
  });
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const items = budgetItemsData?.items ?? [];

  const totalContractAmount = items.reduce((s, i) => s + (i.contractAmount ?? 0), 0);
  const totalInitialBudget = items.reduce((s, i) => s + (i.initialBudget ?? 0), 0);
  const totalRevisedBudget = items.reduce((s, i) => s + (i.revisedBudget ?? 0), 0);
  const totalExpectedProfit = totalContractAmount - totalRevisedBudget;
  const totalExpectedProfitRate = totalContractAmount > 0 ? (totalExpectedProfit / totalContractAmount) * 100 : 0;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListBudgetItemsQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
  }

  function startEdit(item: typeof items[number]) {
    setEditingId(item.id);
    setEditingValues({
      workTypeCode: item.workTypeCode,
      workTypeName: item.workTypeName,
      supplierName: item.supplierName,
      contractAmount: String(item.contractAmount),
      initialBudget: String(item.initialBudget),
      revisedBudget: String(item.revisedBudget),
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: number) {
    const ca = parseFloat(editingValues.contractAmount) || 0;
    const ib = parseFloat(editingValues.initialBudget) || 0;
    const rb = parseFloat(editingValues.revisedBudget) || 0;
    if (!editingValues.workTypeCode || !editingValues.workTypeName) {
      toast({ title: "入力エラー", description: "工種コードと工種名称は必須です。", variant: "destructive" });
      return;
    }
    setSavingId(id);
    try {
      await updateBudgetItem.mutateAsync({
        id: projectId,
        itemId: id,
        data: {
          workTypeCode: editingValues.workTypeCode,
          workTypeName: editingValues.workTypeName,
          supplierName: editingValues.supplierName,
          contractAmount: ca,
          initialBudget: ib,
          revisedBudget: rb,
        },
      });
      invalidate();
      setEditingId(null);
      toast({ title: "保存しました" });
    } catch {
      toast({ title: "保存エラー", description: "更新に失敗しました。", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("この明細を削除してもよいですか？")) return;
    setDeletingId(id);
    try {
      await deleteBudgetItem.mutateAsync({ id: projectId, itemId: id });
      invalidate();
      toast({ title: "削除しました" });
    } catch {
      toast({ title: "削除エラー", description: "削除に失敗しました。", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAddSave() {
    if (!newRow.workTypeCode || !newRow.workTypeName) {
      toast({ title: "入力エラー", description: "工種コードと工種名称は必須です。", variant: "destructive" });
      return;
    }
    setAddSaving(true);
    try {
      await createBudgetItem.mutateAsync({
        id: projectId,
        data: {
          workTypeCode: newRow.workTypeCode,
          workTypeName: newRow.workTypeName,
          supplierName: newRow.supplierName,
          contractAmount: parseFloat(newRow.contractAmount) || 0,
          initialBudget: parseFloat(newRow.initialBudget) || 0,
          revisedBudget: parseFloat(newRow.revisedBudget) || 0,
          sortOrder: items.length,
        },
      });
      invalidate();
      setAddingRow(false);
      setNewRow({ workTypeCode: "", workTypeName: "", supplierName: "", contractAmount: "0", initialBudget: "0", revisedBudget: "0" });
      toast({ title: "追加しました" });
    } catch {
      toast({ title: "追加エラー", description: "追加に失敗しました。", variant: "destructive" });
    } finally {
      setAddSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── サマリーKPI ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-slate-50 border-none shadow-sm">
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">請負金額合計</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-lg font-bold text-slate-900">{formatCurrency(totalContractAmount)}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-none shadow-sm">
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">当初予算合計</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-lg font-bold text-blue-600">{formatCurrency(totalInitialBudget)}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-none shadow-sm">
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">実行予算合計</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-lg font-bold text-indigo-600">{formatCurrency(totalRevisedBudget)}</div>
          </CardContent>
        </Card>
        <Card className={`border-none shadow-sm ${totalExpectedProfit < 0 ? "bg-red-50" : "bg-slate-50"}`}>
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">予定利益率</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className={`text-lg font-bold ${totalExpectedProfit < 0 ? "text-destructive" : "text-emerald-600"}`}>
              {formatPercent(totalExpectedProfitRate)}
            </div>
            <div className={`text-xs font-medium ${totalExpectedProfit < 0 ? "text-destructive" : "text-slate-500"}`}>
              {formatCurrency(totalExpectedProfit)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 実行予算グリッド ── */}
      <Card>
        <CardHeader className="border-b py-3 bg-slate-50/50 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-700">実行予算明細</CardTitle>
            <CardDescription className="text-xs mt-0.5">工種コード・仕入先・金額を入力してください</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 text-teal-700 border-teal-300 hover:bg-teal-50"
              asChild
            >
              <Link href={`/projects/${projectId}/budgets`}>
                <ExternalLink className="w-3.5 h-3.5" />
                実行予算入力画面を開く
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8"
              onClick={() => { setAddingRow(true); }}
              disabled={addingRow}
            >
              <Plus className="w-3.5 h-3.5" />
              行追加
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 text-xs">
                <TableHead className="w-[90px]">工種コード</TableHead>
                <TableHead className="w-[140px]">工種名称</TableHead>
                <TableHead className="w-[130px]">仕入先</TableHead>
                <TableHead className="text-right w-[120px]">請負金額</TableHead>
                <TableHead className="text-right w-[120px]">当初予算</TableHead>
                <TableHead className="text-right w-[120px]">実行予算</TableHead>
                <TableHead className="text-right w-[110px]">予定利益</TableHead>
                <TableHead className="text-right w-[80px]">利益率</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : (
                <>
                  {items.map((item) => {
                    const isEditing = editingId === item.id;
                    const isSaving = savingId === item.id;
                    const isDeleting = deletingId === item.id;
                    const expectedProfit = item.contractAmount - item.revisedBudget;
                    const profitRate = item.contractAmount > 0 ? (expectedProfit / item.contractAmount) * 100 : 0;

                    return (
                      <TableRow key={item.id} className={isEditing ? "bg-blue-50" : "hover:bg-slate-50/50"}>
                        {isEditing ? (
                          <>
                            <TableCell className="py-1.5" colSpan={2}>
                              <Select
                                value={editingValues.workTypeCode || "__none__"}
                                onValueChange={(code) => {
                                  if (code === "__none__") {
                                    setEditingValues((v) => ({ ...v, workTypeCode: "", workTypeName: "" }));
                                    return;
                                  }
                                  const wt = workTypeMaster.find((w) => w.code === code);
                                  setEditingValues((v) => ({
                                    ...v,
                                    workTypeCode: code,
                                    workTypeName: wt?.name ?? "",
                                  }));
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue placeholder="工種を選択" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__" className="text-xs text-slate-400">— 未選択 —</SelectItem>
                                  {workTypeMaster.map((wt) => (
                                    <SelectItem key={wt.id} value={wt.code} className="text-xs">
                                      <span className="font-mono text-slate-500 mr-1">{wt.code}</span>
                                      {wt.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                className="h-7 text-xs"
                                value={editingValues.supplierName}
                                onChange={(e) => setEditingValues((v) => ({ ...v, supplierName: e.target.value }))}
                                placeholder="仕入先"
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                className="h-7 text-xs text-right"
                                type="number"
                                value={editingValues.contractAmount}
                                onChange={(e) => setEditingValues((v) => ({ ...v, contractAmount: e.target.value }))}
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                className="h-7 text-xs text-right"
                                type="number"
                                value={editingValues.initialBudget}
                                onChange={(e) => setEditingValues((v) => ({ ...v, initialBudget: e.target.value }))}
                              />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input
                                className="h-7 text-xs text-right"
                                type="number"
                                value={editingValues.revisedBudget}
                                onChange={(e) => setEditingValues((v) => ({ ...v, revisedBudget: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(item.id); if (e.key === "Escape") cancelEdit(); }}
                                autoFocus
                              />
                            </TableCell>
                            <TableCell className="text-right text-xs text-slate-400" colSpan={2}>—</TableCell>
                            <TableCell className="py-1.5">
                              <div className="flex gap-1">
                                <Button size="icon" variant="default" className="h-7 w-7" onClick={() => saveEdit(item.id)} disabled={isSaving}>
                                  {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit}>
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-xs font-mono text-slate-600">{item.workTypeCode}</TableCell>
                            <TableCell className="text-xs font-medium text-slate-800">{item.workTypeName}</TableCell>
                            <TableCell className="text-xs text-slate-600">{item.supplierName || "—"}</TableCell>
                            <TableCell className="text-xs text-right text-slate-700">{formatCurrency(item.contractAmount)}</TableCell>
                            <TableCell className="text-xs text-right text-blue-600">{formatCurrency(item.initialBudget)}</TableCell>
                            <TableCell className="text-xs text-right text-indigo-600 font-medium">{formatCurrency(item.revisedBudget)}</TableCell>
                            <TableCell className={`text-xs text-right font-medium ${expectedProfit < 0 ? "text-destructive" : "text-emerald-600"}`}>
                              {formatCurrency(expectedProfit)}
                            </TableCell>
                            <TableCell className={`text-xs text-right font-medium ${profitRate < 0 ? "text-destructive" : profitRate < 10 ? "text-yellow-600" : "text-emerald-600"}`}>
                              {profitRate.toFixed(1)}%
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(item)}>
                                  <Edit className="w-3 h-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)} disabled={isDeleting}>
                                  {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                </Button>
                              </div>
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}

                  {/* 新規行追加フォーム */}
                  {addingRow && (
                    <TableRow className="bg-emerald-50">
                      <TableCell className="py-1.5" colSpan={2}>
                        <Select
                          value={newRow.workTypeCode || "__none__"}
                          onValueChange={(code) => {
                            if (code === "__none__") {
                              setNewRow((r) => ({ ...r, workTypeCode: "", workTypeName: "" }));
                              return;
                            }
                            const wt = workTypeMaster.find((w) => w.code === code);
                            setNewRow((r) => ({
                              ...r,
                              workTypeCode: code,
                              workTypeName: wt?.name ?? "",
                            }));
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="工種を選択" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__" className="text-xs text-slate-400">— 未選択 —</SelectItem>
                            {workTypeMaster.map((wt) => (
                              <SelectItem key={wt.id} value={wt.code} className="text-xs">
                                <span className="font-mono text-slate-500 mr-1">{wt.code}</span>
                                {wt.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input
                          className="h-7 text-xs"
                          value={newRow.supplierName}
                          onChange={(e) => setNewRow((r) => ({ ...r, supplierName: e.target.value }))}
                          placeholder="仕入先"
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input
                          className="h-7 text-xs text-right"
                          type="number"
                          value={newRow.contractAmount}
                          onChange={(e) => setNewRow((r) => ({ ...r, contractAmount: e.target.value }))}
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input
                          className="h-7 text-xs text-right"
                          type="number"
                          value={newRow.initialBudget}
                          onChange={(e) => setNewRow((r) => ({ ...r, initialBudget: e.target.value }))}
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input
                          className="h-7 text-xs text-right"
                          type="number"
                          value={newRow.revisedBudget}
                          onChange={(e) => setNewRow((r) => ({ ...r, revisedBudget: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddSave(); if (e.key === "Escape") setAddingRow(false); }}
                        />
                      </TableCell>
                      <TableCell className="text-right text-xs text-slate-400" colSpan={2}>—</TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex gap-1">
                          <Button size="icon" variant="default" className="h-7 w-7 bg-emerald-600 hover:bg-emerald-700" onClick={handleAddSave} disabled={addSaving}>
                            {addSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setAddingRow(false)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )}

              {/* 合計行 */}
              {!isLoading && items.length > 0 && (
                <TableRow className="bg-slate-100 font-bold border-t-2 text-xs">
                  <TableCell colSpan={3} className="text-slate-700">合　計</TableCell>
                  <TableCell className="text-right text-slate-700">{formatCurrency(totalContractAmount)}</TableCell>
                  <TableCell className="text-right text-blue-700">{formatCurrency(totalInitialBudget)}</TableCell>
                  <TableCell className="text-right text-indigo-700">{formatCurrency(totalRevisedBudget)}</TableCell>
                  <TableCell className={`text-right ${totalExpectedProfit < 0 ? "text-destructive" : "text-emerald-700"}`}>
                    {formatCurrency(totalExpectedProfit)}
                  </TableCell>
                  <TableCell className={`text-right ${totalExpectedProfitRate < 0 ? "text-destructive" : "text-emerald-700"}`}>
                    {totalExpectedProfitRate.toFixed(1)}%
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}

              {!isLoading && items.length === 0 && !addingRow && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-slate-400 text-sm">
                    明細がありません。「行追加」ボタンから追加してください。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 原価明細タブ ────────────────────────────────────────────────────────────

const COST_FILTER_OPTIONS: Array<Category | "all"> = ["all", "material", "labor", "subcontract", "expense"];

function CostItemsTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState<Category | "all">("all");
  const [searchText, setSearchText] = useState("");

  const { data: costItems, isLoading } = useListCostItems(
    { projectId, limit: 100 },
    { query: { enabled: !!projectId, queryKey: getListCostItemsQueryKey({ projectId, limit: 100 }) } },
  );

  const createCostItem = useCreateCostItem();
  const deleteCostItem = useDeleteCostItem();

  const form = useForm<z.infer<typeof costItemSchema>>({
    resolver: zodResolver(costItemSchema),
    defaultValues: {
      category: "material",
      description: "",
      vendor: "",
      quantity: "",
      unit: "",
      unitPrice: "",
      amount: 0,
      incurredDate: new Date().toISOString().split("T")[0],
      invoiceNumber: "",
      notes: "",
    },
  });

  const updateAmount = () => {
    const q = Number(form.getValues("quantity"));
    const u = Number(form.getValues("unitPrice"));
    if (!isNaN(q) && !isNaN(u) && q > 0 && u > 0) {
      form.setValue("amount", q * u);
    }
  };

  function onAddSubmit(values: z.infer<typeof costItemSchema>) {
    const data = {
      projectId,
      ...values,
      quantity: values.quantity === "" ? undefined : Number(values.quantity),
      unitPrice: values.unitPrice === "" ? undefined : Number(values.unitPrice),
    };
    createCostItem.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "計上しました", description: "原価明細を登録しました。" });
          queryClient.invalidateQueries({ queryKey: getListCostItemsQueryKey({ projectId, limit: 100 }) });
          queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getGetBudgetVsActualQueryKey({ projectId }) });
          setAddOpen(false);
          form.reset({ ...form.formState.defaultValues, incurredDate: new Date().toISOString().split("T")[0] });
        },
        onError: () => {
          toast({ title: "エラー", description: "原価の登録に失敗しました。", variant: "destructive" });
        },
      },
    );
  }

  async function handleDelete(id: number) {
    if (!window.confirm("この明細を削除してもよいですか？")) return;
    setDeletingId(id);
    try {
      await deleteCostItem.mutateAsync({ id });
      toast({ title: "削除しました" });
      queryClient.invalidateQueries({ queryKey: getListCostItemsQueryKey({ projectId, limit: 100 }) });
      queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: getGetBudgetVsActualQueryKey({ projectId }) });
    } catch {
      toast({ title: "削除エラー", description: "削除に失敗しました。", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  const items = costItems?.items ?? [];

  // カテゴリ別合計
  const totalByCategory: Record<Category, number> = {
    material: 0, labor: 0, subcontract: 0, expense: 0,
  };
  items.forEach((item) => {
    if (item.category in totalByCategory) {
      totalByCategory[item.category as Category] += item.amount;
    }
  });

  // フィルタ適用
  const filteredItems = items.filter((item) => {
    const catMatch = filterCat === "all" || item.category === filterCat;
    const q = searchText.trim().toLowerCase();
    const textMatch =
      !q ||
      item.description.toLowerCase().includes(q) ||
      (item.vendor?.toLowerCase().includes(q) ?? false) ||
      (item.invoiceNumber?.toLowerCase().includes(q) ?? false);
    return catMatch && textMatch;
  });

  return (
    <div className="space-y-4">
      {/* カテゴリ合計バッジ + 検索 + 追加ボタン */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* カテゴリ別合計 */}
          <div className="flex gap-3 flex-wrap">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="flex items-center gap-1.5">
                <Badge variant="outline" className={`${CATEGORY_COLORS[cat]} text-xs`}>
                  {CATEGORY_LABELS[cat]}
                </Badge>
                <span className="text-sm font-medium">{formatCurrency(totalByCategory[cat])}</span>
              </div>
            ))}
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" />
              明細追加
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>原価明細の追加</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onAddSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="incurredDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>発生日 <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>区分 <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="material">材料費</SelectItem>
                            <SelectItem value="labor">労務費</SelectItem>
                            <SelectItem value="subcontract">外注費</SelectItem>
                            <SelectItem value="expense">経費</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>摘要 <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input placeholder="例: 生コンクリート 21-18-20" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="vendor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>取引先</FormLabel>
                        <FormControl><Input placeholder="例: 東京生コン株式会社" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="invoiceNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>伝票番号</FormLabel>
                        <FormControl><Input placeholder="例: INV-2024-001" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>数量</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="0" {...field}
                            onBlur={(e) => { field.onBlur(); updateAmount(); }} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>単位</FormLabel>
                        <FormControl><Input placeholder="m3, 式, 人工" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="unitPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>単価</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="0" {...field}
                            onBlur={(e) => { field.onBlur(); updateAmount(); }} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>金額（円） <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="0" className="font-bold" {...field} />
                        </FormControl>
                        <FormDescription className="text-xs">数量×単価で自動計算</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>キャンセル</Button>
                  <Button type="submit" disabled={createCostItem.isPending}>
                    {createCostItem.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    計上する
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>

        {/* フィルタ + 検索バー */}
        <div className="flex flex-wrap items-center gap-2">
          {COST_FILTER_OPTIONS.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filterCat === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {cat === "all" ? "全て" : CATEGORY_LABELS[cat]}
              {cat !== "all" && (
                <span className="ml-1 text-[10px] opacity-70">
                  ({items.filter((i) => i.category === cat).length})
                </span>
              )}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              className="pl-8 h-8 w-[200px] text-sm"
              placeholder="摘要・取引先で検索"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="w-[110px]">発生日</TableHead>
                  <TableHead className="w-[90px]">区分</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead>取引先</TableHead>
                  <TableHead className="text-right w-[80px]">数量</TableHead>
                  <TableHead className="w-[60px]">単位</TableHead>
                  <TableHead className="text-right">単価</TableHead>
                  <TableHead className="text-right font-bold">金額</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
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
                ) : filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-slate-500">
                      {items.length === 0
                        ? "原価明細がありません。「明細追加」から計上してください。"
                        : "条件に一致する明細がありません。"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item) => (
                    <TableRow key={item.id} className="hover:bg-slate-50/50">
                      <TableCell className="text-slate-600 text-sm">
                        {new Date(item.incurredDate).toLocaleDateString("ja-JP")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${CATEGORY_COLORS[item.category as Category] ?? ""} text-xs`}>
                          {CATEGORY_LABELS[item.category as Category] ?? item.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{item.description}</TableCell>
                      <TableCell className="text-slate-600 text-sm">{item.vendor || "-"}</TableCell>
                      <TableCell className="text-right text-sm">
                        {item.quantity ?? "-"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">{item.unit || ""}</TableCell>
                      <TableCell className="text-right text-sm">
                        {item.unitPrice ? formatCurrency(item.unitPrice) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900">
                        {formatCurrency(item.amount)}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-slate-400 hover:text-destructive"
                          onClick={() => handleDelete(item.id)}
                          disabled={deletingId === item.id}
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {filteredItems.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{filteredItems.length} 件表示 / 全 {items.length} 件</span>
          <span>
            表示合計:{" "}
            <span className="font-bold text-slate-900">
              {formatCurrency(filteredItems.reduce((s, i) => s + i.amount, 0))}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// ─── 収支状況タブ ─────────────────────────────────────────────────────────────

function FinancialTab({ projectId, contractAmount }: { projectId: number; contractAmount: number }) {
  const { data: summary } = useGetProjectSummary(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectSummaryQueryKey(projectId) },
  });
  const { data: bva, isLoading: chartLoading } = useGetBudgetVsActual(
    { projectId },
    { query: { enabled: !!projectId, queryKey: getGetBudgetVsActualQueryKey({ projectId }) } },
  );

  const chartData = bva?.items?.map((item) => ({
    label: item.label,
    予算: item.budget,
    実績: item.actual,
  })) ?? [];

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-50 border-none">
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">請負金額</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-lg font-bold">{formatCurrency(contractAmount)}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-none">
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">実行予算合計</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-lg font-bold text-blue-600">{formatCurrency(summary?.totalBudget ?? 0)}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-none">
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">実績原価</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-lg font-bold text-orange-600">{formatCurrency(summary?.totalActualCost ?? 0)}</div>
            {summary && summary.totalBudget > 0 && (
              <div className="mt-1">
                <Progress
                  value={Math.min(summary.budgetUsageRate, 100)}
                  className="h-1"
                  indicatorClassName={summary.budgetUsageRate > 100 ? "bg-destructive" : "bg-orange-500"}
                />
                <div className="text-xs text-slate-500 mt-0.5">{summary.budgetUsageRate.toFixed(1)}%消化</div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className={`border-none ${(summary?.grossProfit ?? 0) < 0 ? "bg-red-50" : "bg-emerald-50"}`}>
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">予想粗利</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className={`text-lg font-bold ${(summary?.grossProfit ?? 0) < 0 ? "text-destructive" : "text-emerald-600"}`}>
              {formatCurrency(summary?.grossProfit ?? 0)}
            </div>
            <div className={`text-xs font-medium ${(summary?.grossProfitRate ?? 0) < 10 ? "text-destructive" : "text-emerald-600"}`}>
              粗利率 {formatPercent(summary?.grossProfitRate ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 予算実績グラフ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">工種別 予算・実績比較</CardTitle>
          <CardDescription>各工種区分の実行予算と実績原価の比較</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            {chartLoading ? (
              <Skeleton className="h-full w-full" />
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tickFormatter={(val) => `¥${(val / 10000).toFixed(0)}万`}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="予算" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={50} />
                  <Bar dataKey="実績" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={50} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                予算・実績データがありません
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 収支明細テーブル */}
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm font-semibold text-slate-700">工種別収支明細</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>工種区分</TableHead>
                <TableHead className="text-right">予算金額</TableHead>
                <TableHead className="text-right">実績原価</TableHead>
                <TableHead className="text-right">差異</TableHead>
                <TableHead className="text-center w-[180px]">消化率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bva?.items?.map((item) => (
                <TableRow key={item.category} className="hover:bg-slate-50/50">
                  <TableCell>
                    <Badge variant="outline" className={CATEGORY_COLORS[item.category as Category] ?? ""}>
                      {item.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-blue-700">{formatCurrency(item.budget)}</TableCell>
                  <TableCell className="text-right font-medium text-orange-700">{formatCurrency(item.actual)}</TableCell>
                  <TableCell className={`text-right font-medium ${item.variance < 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {item.variance < 0 && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                    {formatCurrency(item.variance)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={Math.min(item.usageRate, 100)}
                        className="h-2 flex-1"
                        indicatorClassName={item.usageRate > 100 ? "bg-destructive" : "bg-primary"}
                      />
                      <span className={`text-xs font-medium w-9 text-right ${item.usageRate > 100 ? "text-destructive" : "text-slate-600"}`}>
                        {item.usageRate.toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 基本情報タブ ─────────────────────────────────────────────────────────────

function BasicInfoTab({ project, projectId }: { project: ProjectDetail; projectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const updateProject = useUpdateProject();
  const clients = useClients();

  const form = useForm<z.infer<typeof projectEditSchema>>({
    resolver: zodResolver(projectEditSchema),
    defaultValues: {
      name: project.name,
      shortName: project.shortName ?? "",
      clientName: project.clientName,
      location: project.location ?? "",
      contractAmount: project.contractAmount,
      status: project.status as "planning" | "active" | "completed" | "suspended",
      startDate: project.startDate,
      endDate: project.endDate,
      description: project.description ?? "",
      estimateNumber: project.estimateNumber ?? "",
      orderType: project.orderType ?? "",
      overview: project.overview ?? "",
      taxExcludedAmount: project.taxExcludedAmount != null ? project.taxExcludedAmount : "",
      taxRate: project.taxRate != null ? project.taxRate : "",
      taxAmount: project.taxAmount != null ? project.taxAmount : "",
      taxIncludedAmount: project.taxIncludedAmount != null ? project.taxIncludedAmount : "",
      department: project.department ?? "",
      salesStaff: project.salesStaff ?? "",
      siteManager: project.siteManager ?? "",
      category1: project.category1 ?? "",
      category2: project.category2 ?? "",
      category3: project.category3 ?? "",
      orderDate: project.orderDate ?? "",
      handoverDate: project.handoverDate ?? "",
      progressRate: project.progressRate ?? undefined,
      recognitionBasis: project.recognitionBasis ?? "",
      publicPrivateType: project.publicPrivateType ?? "",
      clientCode: project.clientCode ?? "",
      constructionHistoryType: project.constructionHistoryType ?? "",
      constructionHistoryEngineer: project.constructionHistoryEngineer ?? "",
    },
  });

  const taxExcludedAmount = form.watch("taxExcludedAmount");
  const taxRate = form.watch("taxRate");

  useEffect(() => {
    const excluded = taxExcludedAmount === "" || taxExcludedAmount == null ? null : Number(taxExcludedAmount);
    const rate = taxRate === "" || taxRate == null ? null : Number(taxRate);
    if (excluded !== null && !isNaN(excluded) && rate !== null && !isNaN(rate)) {
      const tax = Math.floor(excluded * rate / 100);
      const included = excluded + tax;
      form.setValue("taxAmount", tax);
      form.setValue("taxIncludedAmount", included);
      form.setValue("contractAmount", included);
    }
  }, [taxExcludedAmount, taxRate]);

  function onSubmit(values: z.infer<typeof projectEditSchema>) {
    const normalizeDate = (v: string | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
    const normalizeStr = (v: string | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
    const normalizeNum = (v: number | string | undefined | null) => {
      if (v === "" || v == null) return undefined;
      const n = Number(v);
      return isNaN(n) ? undefined : n;
    };

    const payload = {
      name: values.name,
      shortName: normalizeStr(values.shortName),
      clientName: values.clientName,
      location: values.location,
      contractAmount: values.contractAmount,
      status: values.status,
      startDate: values.startDate,
      endDate: values.endDate,
      description: normalizeStr(values.description),
      estimateNumber: normalizeStr(values.estimateNumber),
      orderType: normalizeStr(values.orderType),
      overview: normalizeStr(values.overview),
      taxExcludedAmount: normalizeNum(values.taxExcludedAmount),
      taxRate: normalizeNum(values.taxRate),
      taxAmount: normalizeNum(values.taxAmount),
      taxIncludedAmount: normalizeNum(values.taxIncludedAmount),
      department: normalizeStr(values.department),
      salesStaff: normalizeStr(values.salesStaff),
      siteManager: normalizeStr(values.siteManager),
      category1: normalizeStr(values.category1),
      category2: normalizeStr(values.category2),
      category3: normalizeStr(values.category3),
      orderDate: normalizeDate(values.orderDate),
      handoverDate: normalizeDate(values.handoverDate),
      progressRate: normalizeNum(values.progressRate),
      recognitionBasis: normalizeStr(values.recognitionBasis),
      publicPrivateType: normalizeStr(values.publicPrivateType),
      clientCode: normalizeStr(values.clientCode),
      constructionHistoryType: normalizeStr(values.constructionHistoryType),
      constructionHistoryEngineer: normalizeStr(values.constructionHistoryEngineer),
    };

    updateProject.mutate(
      { id: projectId, data: payload },
      {
        onSuccess: () => {
          toast({ title: "更新しました", description: "工事情報を保存しました。" });
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
          setIsEditing(false);
        },
        onError: () => {
          toast({ title: "エラー", description: "更新に失敗しました。", variant: "destructive" });
        },
      },
    );
  }

  if (isEditing) {
    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左カラム */}
            <Card>
              <CardHeader className="py-3 border-b bg-slate-50/60">
                <CardTitle className="text-sm font-semibold text-slate-700">工事基本情報</CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事名称 <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="shortName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事略称</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estimateNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>見積番号</FormLabel>
                      <FormControl><Input placeholder="例: Q202401-001" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事場所 <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>得意先 <span className="text-destructive">*</span></FormLabel>
                      <div className="flex gap-2">
                        <Select
                          onValueChange={(val) => {
                            if (val === "__manual__") {
                              form.setValue("clientCode", "");
                              return;
                            }
                            const found = clients.find((c) => c.clientCode === val);
                            if (found) {
                              field.onChange(found.name);
                              form.setValue("clientCode", found.clientCode);
                            }
                          }}
                          value={clients.find((c) => c.clientCode === form.getValues("clientCode")) ? (form.getValues("clientCode") || "__manual__") : "__manual__"}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="得意先を選択" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__manual__">— 直接入力 —</SelectItem>
                            {clients.map((c) => (
                              <SelectItem key={c.id} value={c.clientCode}>
                                <span className="font-mono text-slate-500 mr-1 text-xs">{c.clientCode}</span>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormControl><Input className="flex-1" {...field} /></FormControl>
                        <Input className="w-32" placeholder="得意先コード" {...form.register("clientCode")} />
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="orderType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>受注区分</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="選択してください" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="元請">元請</SelectItem>
                          <SelectItem value="下請">下請</SelectItem>
                          <SelectItem value="直工事">直工事</SelectItem>
                          <SelectItem value="その他">その他</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="overview"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事概要</FormLabel>
                      <FormControl><Textarea rows={3} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-3 rounded-md border border-slate-200 p-4 bg-slate-50/50">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">請負金額</p>
                  <FormField
                    control={form.control}
                    name="taxExcludedAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>税抜金額（円）</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="0" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="taxRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>消費税率</FormLabel>
                        <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value ?? 10)}>
                          <FormControl>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {TAX_RATES.map((r) => (
                              <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
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
                      name="taxAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>消費税額（円）</FormLabel>
                          <FormControl>
                            <Input type="number" readOnly className="bg-slate-100 text-slate-600" {...field} value={field.value ?? ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="taxIncludedAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>税込金額（円）</FormLabel>
                          <FormControl>
                            <Input type="number" readOnly className="bg-slate-100 font-semibold text-slate-800" {...field} value={field.value ?? ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>備考</FormLabel>
                      <FormControl><Textarea rows={3} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* 右カラム */}
            <Card>
              <CardHeader className="py-3 border-b bg-slate-50/60">
                <CardTitle className="text-sm font-semibold text-slate-700">担当・分類・工期</CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-4">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ステータス <span className="text-destructive">*</span></FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="planning">計画中</SelectItem>
                          <SelectItem value="active">施工中</SelectItem>
                          <SelectItem value="completed">完工</SelectItem>
                          <SelectItem value="suspended">中断</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事部門</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="salesStaff"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>営業担当</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="siteManager"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事担当</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事分類1</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事分類2</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category3"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事分類3</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-3 rounded-md border border-slate-200 p-4 bg-slate-50/50">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">工期・日程</p>
                  <FormField
                    control={form.control}
                    name="orderDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>受注日</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>着工日 <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>竣工予定日 <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="handoverDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>引渡日（予定）</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="progressRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>進捗率（%）</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={100} placeholder="0〜100" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recognitionBasis"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>計上基準</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="選択してください" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="完成基準">完成基準</SelectItem>
                          <SelectItem value="進行基準">進行基準</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => { setIsEditing(false); form.reset(); }}>
              <X className="w-4 h-4 mr-1" />キャンセル
            </Button>
            <Button type="submit" disabled={updateProject.isPending}>
              {updateProject.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              保存する
            </Button>
          </div>
        </form>
      </Form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
          <Edit className="w-4 h-4 mr-1" />
          編集
        </Button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左カラム */}
        <Card>
          <CardHeader className="py-3 border-b bg-slate-50/60">
            <CardTitle className="text-sm font-semibold text-slate-700">工事基本情報</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-slate-500 mb-0.5">工事名称</dt>
                <dd className="font-medium text-slate-900">{project.name}</dd>
              </div>
              {project.shortName && (
                <div>
                  <dt className="text-slate-500 mb-0.5">工事略称</dt>
                  <dd className="font-medium text-slate-900">{project.shortName}</dd>
                </div>
              )}
              {project.estimateNumber && (
                <div>
                  <dt className="text-slate-500 mb-0.5">見積番号</dt>
                  <dd className="font-medium text-slate-900">{project.estimateNumber}</dd>
                </div>
              )}
              <div>
                <dt className="text-slate-500 mb-0.5">工事場所</dt>
                <dd className="font-medium text-slate-900">{project.location || "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500 mb-0.5">得意先</dt>
                <dd className="font-medium text-slate-900">
                  {project.clientName}
                  {project.clientCode && (
                    <span className="ml-2 text-xs font-mono text-slate-500">({project.clientCode})</span>
                  )}
                </dd>
              </div>
              {project.orderType && (
                <div>
                  <dt className="text-slate-500 mb-0.5">受注区分</dt>
                  <dd className="font-medium text-slate-900">{project.orderType}</dd>
                </div>
              )}
              {project.overview && (
                <div>
                  <dt className="text-slate-500 mb-0.5">工事概要</dt>
                  <dd className="font-medium text-slate-900 whitespace-pre-wrap">{project.overview}</dd>
                </div>
              )}
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">請負金額</p>
                <div className="grid grid-cols-2 gap-2">
                  {project.taxExcludedAmount != null && (
                    <div>
                      <dt className="text-slate-500 mb-0.5">税抜金額</dt>
                      <dd className="font-medium text-slate-900">{formatCurrency(project.taxExcludedAmount)}</dd>
                    </div>
                  )}
                  {project.taxRate != null && (
                    <div>
                      <dt className="text-slate-500 mb-0.5">消費税率</dt>
                      <dd className="font-medium text-slate-900">{project.taxRate}%</dd>
                    </div>
                  )}
                  {project.taxAmount != null && (
                    <div>
                      <dt className="text-slate-500 mb-0.5">消費税額</dt>
                      <dd className="font-medium text-slate-900">{formatCurrency(project.taxAmount)}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-slate-500 mb-0.5">税込金額（請負金額）</dt>
                    <dd className="font-bold text-slate-900">{formatCurrency(project.contractAmount)}</dd>
                  </div>
                </div>
              </div>
              {project.description && (
                <div>
                  <dt className="text-slate-500 mb-0.5">備考</dt>
                  <dd className="font-medium text-slate-900 whitespace-pre-wrap">{project.description}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* 右カラム */}
        <Card>
          <CardHeader className="py-3 border-b bg-slate-50/60">
            <CardTitle className="text-sm font-semibold text-slate-700">担当・分類・工期</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-slate-500 mb-0.5">ステータス</dt>
                <dd>
                  <Badge variant="outline" className={STATUS_COLORS[project.status] ?? ""}>
                    {STATUS_LABELS[project.status] ?? project.status}
                  </Badge>
                </dd>
              </div>
              {project.department && (
                <div>
                  <dt className="text-slate-500 mb-0.5">工事部門</dt>
                  <dd className="font-medium text-slate-900">{project.department}</dd>
                </div>
              )}
              {project.salesStaff && (
                <div>
                  <dt className="text-slate-500 mb-0.5">営業担当</dt>
                  <dd className="font-medium text-slate-900">{project.salesStaff}</dd>
                </div>
              )}
              {project.siteManager && (
                <div>
                  <dt className="text-slate-500 mb-0.5">工事担当</dt>
                  <dd className="font-medium text-slate-900">{project.siteManager}</dd>
                </div>
              )}
              {(project.category1 || project.category2 || project.category3) && (
                <div>
                  <dt className="text-slate-500 mb-0.5">工事分類</dt>
                  <dd className="font-medium text-slate-900">
                    {[project.category1, project.category2, project.category3].filter(Boolean).join(" / ")}
                  </dd>
                </div>
              )}
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">工期・日程</p>
                {project.orderDate && (
                  <div>
                    <dt className="text-slate-500 mb-0.5">受注日</dt>
                    <dd className="font-medium text-slate-900">{new Date(project.orderDate).toLocaleDateString("ja-JP")}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-slate-500 mb-0.5">着工〜竣工</dt>
                  <dd className="font-medium text-slate-900">
                    {new Date(project.startDate).toLocaleDateString("ja-JP")} 〜{" "}
                    {new Date(project.endDate).toLocaleDateString("ja-JP")}
                  </dd>
                </div>
                {project.handoverDate && (
                  <div>
                    <dt className="text-slate-500 mb-0.5">引渡予定日</dt>
                    <dd className="font-medium text-slate-900">{new Date(project.handoverDate).toLocaleDateString("ja-JP")}</dd>
                  </div>
                )}
              </div>
              {project.progressRate != null && (
                <div>
                  <dt className="text-slate-500 mb-0.5">進捗率</dt>
                  <dd className="font-medium text-slate-900">{project.progressRate}%</dd>
                </div>
              )}
              {project.recognitionBasis && (
                <div>
                  <dt className="text-slate-500 mb-0.5">計上基準</dt>
                  <dd className="font-medium text-slate-900">{project.recognitionBasis}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── メインコンポーネント ──────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0", 10);

  const { data: project, isLoading: projectLoading } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: summary, isLoading: summaryLoading } = useGetProjectSummary(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectSummaryQueryKey(projectId) },
  });
  const { data: budgetItemsCheck } = useListBudgetItems(projectId, {
    query: { enabled: !!projectId, queryKey: getListBudgetItemsQueryKey(projectId) },
  });
  const hasBudgetItems = (budgetItemsCheck?.items?.length ?? 0) > 0;

  if (projectLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-slate-500">工事が見つかりません。</p>
        <Button variant="link" asChild className="mt-2 px-0">
          <Link href="/projects">← 工事一覧へ戻る</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* ── ヘッダー ── */}
      <div className="flex items-start gap-4">
        <Button variant="outline" size="icon" asChild className="mt-1 shrink-0">
          <Link href="/projects">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 truncate">{project.name}</h1>
            <Badge variant="outline" className={STATUS_COLORS[project.status] ?? ""}>
              {STATUS_LABELS[project.status] ?? project.status}
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {project.projectCode} ／ {project.clientName}
          </p>
        </div>
      </div>

      {/* ── KPI サマリー（常時表示） ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-slate-50 border-none shadow-sm">
          <CardHeader className="py-3 pb-1">
            <CardTitle className="text-xs text-slate-500 font-medium">請負金額</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="text-lg font-bold">{formatCurrency(project.contractAmount)}</div>
          </CardContent>
        </Card>

        {summaryLoading ? (
          <>
            <Card><CardContent className="p-4"><Skeleton className="h-8" /></CardContent></Card>
            <Card><CardContent className="p-4"><Skeleton className="h-8" /></CardContent></Card>
            <Card><CardContent className="p-4"><Skeleton className="h-8" /></CardContent></Card>
          </>
        ) : summary ? (
          <>
            <Card className="border-none shadow-sm">
              <CardHeader className="py-3 pb-1">
                <CardTitle className="text-xs text-slate-500 font-medium">実行予算</CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="text-lg font-bold text-blue-600">{formatCurrency(summary.totalBudget)}</div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardHeader className="py-3 pb-1">
                <CardTitle className="text-xs text-slate-500 font-medium flex items-center gap-1">
                  実績原価
                  {summary.budgetUsageRate > 100 && <AlertTriangle className="w-3 h-3 text-destructive" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="text-lg font-bold text-orange-600">{formatCurrency(summary.totalActualCost)}</div>
                <div className="mt-1.5">
                  <Progress
                    value={Math.min(summary.budgetUsageRate, 100)}
                    className="h-1"
                    indicatorClassName={summary.budgetUsageRate > 100 ? "bg-destructive" : "bg-orange-500"}
                  />
                  <div className={`text-xs mt-0.5 ${summary.budgetUsageRate > 100 ? "text-destructive" : "text-slate-500"}`}>
                    {summary.budgetUsageRate.toFixed(1)}%消化
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className={`border-none shadow-sm ${summary.grossProfit < 0 ? "bg-red-50" : ""}`}>
              <CardHeader className="py-3 pb-1">
                <CardTitle className="text-xs text-slate-500 font-medium">予想粗利</CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <div className={`text-lg font-bold ${summary.grossProfit < 0 ? "text-destructive" : "text-emerald-600"}`}>
                  {formatCurrency(summary.grossProfit)}
                </div>
                <div className={`text-xs font-medium ${summary.grossProfitRate < 10 ? "text-destructive" : "text-emerald-600"}`}>
                  粗利率 {formatPercent(summary.grossProfitRate)}
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      {/* ── タブ ── */}
      <Tabs defaultValue="budget" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-2">
          <TabsTrigger value="basic" className="text-xs sm:text-sm gap-1">
            <FileText className="w-3.5 h-3.5 hidden sm:block" />
            基本情報
          </TabsTrigger>
          <TabsTrigger value="budget" className="text-xs sm:text-sm gap-1">
            <Calculator className="w-3.5 h-3.5 hidden sm:block" />
            実行予算
            {!hasBudgetItems && (
              <Badge className="ml-1 text-[10px] px-1 py-0 h-4 bg-orange-500 text-white border-none">未登録</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="costs" className="text-xs sm:text-sm gap-1">
            <ClipboardList className="w-3.5 h-3.5 hidden sm:block" />
            原価明細
          </TabsTrigger>
          <TabsTrigger value="financial" className="text-xs sm:text-sm gap-1">
            <BarChart2 className="w-3.5 h-3.5 hidden sm:block" />
            収支状況
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <BasicInfoTab project={project} projectId={projectId} />
        </TabsContent>

        <TabsContent value="budget">
          <BudgetTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="costs">
          <CostItemsTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="financial">
          <FinancialTab projectId={projectId} contractAmount={project.contractAmount} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
