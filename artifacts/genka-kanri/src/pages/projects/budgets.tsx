import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import {
  useGetProject, useGetProjectSummary, useListBudgetItems,
  useCreateBudgetItem, useUpdateBudgetItem, useDeleteBudgetItem,
  useBulkCreatePurchaseOrders,
  getGetProjectQueryKey, getGetProjectSummaryQueryKey,
  getListBudgetItemsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, Save, Trash2, Plus, RefreshCw, Settings2, Copy, ChevronDown, ChevronRight, Download, Lock,
  ShoppingCart, PackageCheck, Loader2,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { UnitPricePicker, type UnitPriceSelection } from "@/components/unit-price-picker";

type WorkType = { id: number; code: string; name: string; constructionType?: string };
type VendorItem = { id: number; name: string; code: string | null; groupName?: string | null };

type RowState = {
  id?: number;
  purchaseOrderId: number | null;
  workTypeCode: string;
  workTypeName: string;
  vendorId: string;
  supplierName: string;
  contractAmount: string;
  initialBudget: string;
  revisedBudget: string;
  isDirty: boolean;
  isNew: boolean;
  isOriginalLocked: boolean;
};

function fmt(n: number) {
  return n === 0 ? "" : n.toLocaleString("ja-JP");
}

function pct(num: number, denom: number) {
  if (!denom) return "—";
  return (num / denom * 100).toFixed(1) + "%";
}

function parseN(s: string) {
  return parseFloat(s.replace(/,/g, "")) || 0;
}

const COLS: { key: keyof RowState; label: string; width: string; align: "left" | "right"; numeric?: boolean; hidden?: boolean }[] = [
  { key: "workTypeCode",   label: "工種",     width: "240px", align: "left" },
  { key: "workTypeName",   label: "工種名",   width: "0px",   align: "left", hidden: true },
  { key: "vendorId",       label: "仕入先",   width: "200px", align: "left" },
  { key: "contractAmount", label: "請負金額", width: "110px", align: "right", numeric: true },
  { key: "initialBudget",  label: "当初予算", width: "110px", align: "right", numeric: true },
  { key: "revisedBudget",  label: "実行予算", width: "110px", align: "right", numeric: true },
];

function useWorkTypes() {
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  useEffect(() => {
    fetch("/api/work-types")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setWorkTypes(data);
      })
      .catch(() => {});
  }, []);
  return workTypes;
}

type MonitorRow = {
  workTypeCode: string;
  workTypeName: string;
  revisedBudget: number;
  orderedAmount: number;
  actualCost: number;
  budgetRemaining: number;
  consumptionRate: number | null;
};

function useMonitorData(projectId: number) {
  return useQuery<{ items: MonitorRow[] }>({
    queryKey: ["/api/projects", projectId, "budget-items", "monitor"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/budget-items/monitor`);
      if (!res.ok) return { items: [] };
      return res.json();
    },
    enabled: !!projectId,
  });
}

function useVendors() {
  const { data } = useQuery<VendorItem[]>({
    queryKey: ["/api/vendors"],
    queryFn: async () => {
      const res = await fetch("/api/vendors");
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (Array.isArray(json.items) ? json.items : []);
    },
    staleTime: 60_000,
  });
  return Array.isArray(data) ? data : [];
}

export default function BudgetManagement() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const workTypes = useWorkTypes();
  const vendors = useVendors();

  const { data: project } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: summary } = useGetProjectSummary(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectSummaryQueryKey(projectId) },
  });
  const { data: budgetData, isLoading } = useListBudgetItems(projectId, {
    query: { enabled: !!projectId, queryKey: getListBudgetItemsQueryKey(projectId) },
  });

  const createItem = useCreateBudgetItem();
  const updateItem = useUpdateBudgetItem();
  const deleteItem = useDeleteBudgetItem();
  const bulkCreatePO = useBulkCreatePurchaseOrders();

  const [rows, setRows] = useState<RowState[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  // 一括発注モーダル state
  const [bulkOrderOpen, setBulkOrderOpen] = useState(false);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [vendorGroupSettings, setVendorGroupSettings] = useState<Map<number, { deliveryDate: string; notes: string }>>(new Map());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [displayMode, setDisplayMode] = useState<"contract" | "progress">("contract");
  const [profitMode, setProfitMode] = useState<"profit" | "remaining">("profit");
  const [showExpectedProfit, setShowExpectedProfit] = useState(true);
  const [regForm, setRegForm] = useState("工種別仕入先毎");
  const [budgetInput, setBudgetInput] = useState("すべて");
  const [showDisplaySettings, setShowDisplaySettings] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [showTax, setShowTax] = useState(false);

  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [estimateDialogOpen, setEstimateDialogOpen] = useState(false);
  const [allEstimates, setAllEstimates] = useState<{ id: number; estimateNumber: string; subject: string; clientName: string; estimateDate: string; taxIncludedAmount: number }[]>([]);

  const [vendorSearch, setVendorSearch] = useState("");
  const [addVendorOpen, setAddVendorOpen] = useState(false);
  const [addVendorName, setAddVendorName] = useState("");
  const [addVendorCode, setAddVendorCode] = useState("");
  const [addVendorSaving, setAddVendorSaving] = useState(false);
  const [pendingVendorRowIdx, setPendingVendorRowIdx] = useState<number | null>(null);

  const filteredVendors = vendors.filter(v => {
    const q = vendorSearch.toLowerCase();
    return !q || v.name.toLowerCase().includes(q) || (v.code ?? "").toLowerCase().includes(q);
  });

  useEffect(() => {
    if (budgetData?.items) {
      setRows(budgetData.items.map(item => ({
        id: item.id,
        purchaseOrderId: item.purchaseOrderId ?? null,
        workTypeCode: item.workTypeCode,
        workTypeName: item.workTypeName,
        vendorId: item.vendorId ? String(item.vendorId) : "",
        supplierName: item.supplierName,
        contractAmount: String(item.contractAmount),
        initialBudget: String(item.initialBudget),
        revisedBudget: String(item.revisedBudget),
        isDirty: false,
        isNew: false,
        isOriginalLocked: item.isOriginalLocked ?? false,
      })));
      setSelectedRows(new Set());
    }
  }, [budgetData]);

  function handleCellChange(rowIdx: number, col: keyof RowState, value: string) {
    setRows(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      return { ...r, [col]: value, isDirty: true };
    }));
  }

  function handleSelectWorkType(rowIdx: number, wt: WorkType) {
    setRows(prev => prev.map((r, i) =>
      i === rowIdx ? { ...r, workTypeCode: wt.code, workTypeName: wt.name, isDirty: true } : r
    ));
  }

  function handleSelectVendor(rowIdx: number, vendorId: string) {
    const vd = vendors.find(v => String(v.id) === vendorId);
    setRows(prev => prev.map((r, i) =>
      i === rowIdx
        ? { ...r, vendorId, supplierName: vd?.name ?? "", isDirty: true }
        : r
    ));
  }

  async function handleAddVendor() {
    if (!addVendorName.trim()) return;
    setAddVendorSaving(true);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addVendorName.trim(),
          code: addVendorCode.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const newVendor = await res.json() as { id: number; name: string };
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      if (pendingVendorRowIdx !== null) {
        setRows(prev => prev.map((r, i) =>
          i === pendingVendorRowIdx
            ? { ...r, vendorId: String(newVendor.id), supplierName: newVendor.name, isDirty: true }
            : r
        ));
      }
      setAddVendorOpen(false);
      setAddVendorName("");
      setAddVendorCode("");
      setPendingVendorRowIdx(null);
      toast({ title: "仕入先を登録しました" });
    } catch {
      toast({ title: "登録エラー", description: "仕入先の登録に失敗しました。", variant: "destructive" });
    } finally {
      setAddVendorSaving(false);
    }
  }

  async function doImport(estimateId: number | null) {
    setImporting(true);
    try {
      const url = estimateId
        ? `/api/projects/${projectId}/budget-items/import-from-estimate?estimateId=${estimateId}`
        : `/api/projects/${projectId}/budget-items/import-from-estimate`;
      const importRes = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (importRes.status === 409) {
        toast({ title: "当初予算は登録済みです", variant: "destructive" });
        return;
      }
      if (!importRes.ok) {
        const body = await importRes.json().catch(() => ({})) as { message?: string };
        toast({ title: "取込みエラー", description: body.message ?? "取込みに失敗しました。", variant: "destructive" });
        return;
      }
      const data = await importRes.json() as { estimateNumber: string; importedCount: number };
      queryClient.invalidateQueries({ queryKey: getListBudgetItemsQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
      toast({ title: `見積書 ${data.estimateNumber} から ${data.importedCount} 件を取込みました` });
    } catch {
      toast({ title: "取込みエラー", description: "予期しないエラーが発生しました。", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  async function handleImportFromEstimate() {
    if (rows.length > 0) {
      toast({ title: "当初予算は登録済みです", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      if (project?.estimateNumber) {
        // 工事に見積番号が設定されている → dryRun で確認してそのまま取込み
        const previewRes = await fetch(
          `/api/projects/${projectId}/budget-items/import-from-estimate?dryRun=true`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );
        if (previewRes.ok) {
          const preview = await previewRes.json() as { estimateNumber: string; importableCount: number };
          const confirmed = window.confirm(
            `見積書 ${preview.estimateNumber} の明細 ${preview.importableCount} 件を当初予算として取込みます。よろしいですか？`
          );
          if (!confirmed) return;
          await doImport(null);
          return;
        }
        // 見積番号で見つからなかった場合はダイアログへフォールスルー
      }
      // 見積番号未設定 or 見積書が見つからない → 一覧から選択
      const res = await fetch("/api/estimates");
      if (!res.ok) {
        toast({ title: "エラー", description: "見積書一覧の取得に失敗しました。", variant: "destructive" });
        return;
      }
      const data = await res.json() as { items: typeof allEstimates };
      setAllEstimates(data.items ?? []);
      setEstimateDialogOpen(true);
    } catch {
      toast({ title: "取込みエラー", description: "予期しないエラーが発生しました。", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  function handleAddRow() {
    const newRow: RowState = {
      purchaseOrderId: null,
      workTypeCode: "", workTypeName: "",
      vendorId: "", supplierName: "",
      contractAmount: "0", initialBudget: "0", revisedBudget: "0",
      isDirty: true, isNew: true, isOriginalLocked: false,
    };
    setRows(prev => [...prev, newRow]);
    setTimeout(() => {
      const idx = rows.length;
      const ref = cellRefs.current[`${idx}-workTypeCode`];
      if (ref) ref.focus();
    }, 50);
  }

  function handleCopyRow(rowIdx: number) {
    if (rowIdx === 0) return;
    const prev = rows[rowIdx - 1];
    setRows(old => old.map((r, i) =>
      i === rowIdx ? {
        ...r,
        workTypeCode: prev.workTypeCode,
        workTypeName: prev.workTypeName,
        vendorId: prev.vendorId,
        supplierName: prev.supplierName,
        contractAmount: prev.contractAmount,
        initialBudget: prev.initialBudget,
        revisedBudget: prev.revisedBudget,
        isDirty: true,
      } : r
    ));
  }

  function handleToggleRow(rowIdx: number) {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      return next;
    });
  }

  async function handleDeleteSelected() {
    if (selectedRows.size === 0) {
      toast({ title: "行を選択してください", variant: "destructive" });
      return;
    }
    if (!window.confirm(`選択した ${selectedRows.size} 行を削除しますか？`)) return;

    const idxList = Array.from(selectedRows).sort((a, b) => b - a);
    for (const idx of idxList) {
      const row = rows[idx];
      if (row.id) {
        try {
          await deleteItem.mutateAsync({ id: projectId, itemId: row.id });
        } catch {
          toast({ title: "削除エラー", description: `行 ${idx + 1} の削除に失敗しました。`, variant: "destructive" });
          return;
        }
      }
    }
    setRows(prev => prev.filter((_, i) => !selectedRows.has(i)));
    setSelectedRows(new Set());
    queryClient.invalidateQueries({ queryKey: getListBudgetItemsQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    toast({ title: `${idxList.length} 行を削除しました` });
  }

  // 選択行のうち発注可能（purchaseOrderId なし & vendorId あり）な行を仕入先 ID でグループ化
  const computedVendorGroups = (() => {
    const map = new Map<number, { vendorId: number; vendorName: string; items: { rowIdx: number; workTypeName: string; revisedBudget: number }[] }>();
    for (const rowIdx of Array.from(selectedRows)) {
      const row = rows[rowIdx];
      if (!row || !row.id || !row.vendorId || row.purchaseOrderId) continue; // 未保存・発注不可行はスキップ
      const vid = parseInt(row.vendorId);
      if (!map.has(vid)) {
        map.set(vid, { vendorId: vid, vendorName: row.supplierName || vendors.find(v => v.id === vid)?.name || String(vid), items: [] });
      }
      map.get(vid)!.items.push({ rowIdx, workTypeName: row.workTypeName, revisedBudget: parseN(row.revisedBudget) });
    }
    return Array.from(map.values());
  })();

  function openBulkOrderModal() {
    if (computedVendorGroups.length === 0) return;
    const next = new Map<number, { deliveryDate: string; notes: string }>();
    for (const grp of computedVendorGroups) {
      next.set(grp.vendorId, { deliveryDate: "", notes: "" });
    }
    setVendorGroupSettings(next);
    setBulkOrderOpen(true);
  }

  async function handleBulkCreate() {
    if (computedVendorGroups.length === 0) return;
    setBulkSubmitting(true);
    try {
      await bulkCreatePO.mutateAsync({
        id: projectId,
        data: {
          orderDate,
          groups: computedVendorGroups.map(grp => {
            const s = vendorGroupSettings.get(grp.vendorId) ?? { deliveryDate: "", notes: "" };
            return {
              vendorId: grp.vendorId,
              deliveryDate: s.deliveryDate || undefined,
              notes: s.notes || undefined,
              budgetItemIds: grp.items.map(it => rows[it.rowIdx].id!).filter(Boolean),
            };
          }),
        },
      });
      setBulkOrderOpen(false);
      setSelectedRows(new Set());
      queryClient.invalidateQueries({ queryKey: getListBudgetItemsQueryKey(projectId) });
      toast({ title: "発注書を作成しました", description: `${computedVendorGroups.length} 社向けの発注書を作成しました。` });
    } catch {
      toast({ title: "発注書の作成に失敗しました", variant: "destructive" });
    } finally {
      setBulkSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colKey: string) {
    const visibleCols = COLS.filter(c => !c.hidden && c.key !== "vendorId");
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      if (rowIdx > 0) {
        handleCopyRow(rowIdx);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const colIdx = visibleCols.findIndex(c => c.key === colKey);
      let nextColIdx = colIdx + (e.shiftKey ? -1 : 1);
      let nextRowIdx = rowIdx;
      if (nextColIdx >= visibleCols.length) { nextColIdx = 0; nextRowIdx++; }
      if (nextColIdx < 0) { nextColIdx = visibleCols.length - 1; nextRowIdx--; }
      if (nextRowIdx >= 0 && nextRowIdx < rows.length) {
        const ref = cellRefs.current[`${nextRowIdx}-${visibleCols[nextColIdx].key}`];
        if (ref) ref.focus();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const nextRowIdx = rowIdx + 1;
      if (nextRowIdx < rows.length) {
        const ref = cellRefs.current[`${nextRowIdx}-${colKey}`];
        if (ref) ref.focus();
      } else {
        handleAddRow();
      }
    }
  }

  async function handleSave() {
    const dirtyRows = rows.filter(r => r.isDirty || r.isNew);
    if (dirtyRows.length === 0) {
      toast({ title: "変更はありません" });
      return;
    }
    setSaving(true);
    let errorCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.isDirty && !row.isNew) continue;
      if (!row.workTypeCode && !row.workTypeName) continue;
      const data: {
        workTypeCode: string;
        workTypeName: string;
        supplierCode: string;
        supplierName: string;
        vendorId: number | null;
        contractAmount: number;
        initialBudget?: number;
        revisedBudget: number;
        sortOrder: number;
      } = {
        workTypeCode: row.workTypeCode || "—",
        workTypeName: row.workTypeName || "—",
        supplierCode: "",
        supplierName: row.supplierName,
        vendorId: row.vendorId ? parseInt(row.vendorId) : null,
        contractAmount: parseN(row.contractAmount),
        revisedBudget: parseN(row.revisedBudget),
        sortOrder: i,
      };
      data.initialBudget = parseN(row.initialBudget);
      try {
        if (row.id) {
          await updateItem.mutateAsync({ id: projectId, itemId: row.id, data });
        } else {
          const created = await createItem.mutateAsync({ id: projectId, data });
          setRows(prev => prev.map((r, idx) => idx === i ? { ...r, id: created.id, isNew: false, isDirty: false } : r));
        }
        setRows(prev => prev.map((r, idx) => idx === i ? { ...r, isNew: false, isDirty: false } : r));
      } catch {
        errorCount++;
      }
    }
    queryClient.invalidateQueries({ queryKey: getListBudgetItemsQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    setSaving(false);
    if (errorCount > 0) {
      toast({ title: "一部保存失敗", description: `${errorCount} 行の保存に失敗しました。`, variant: "destructive" });
    } else {
      toast({ title: "保存しました", description: "実行予算を保存しました。" });
    }
  }

  const contractAmountFromProject = project?.contractAmount ?? 0;
  const totalRevisedBudget  = rows.reduce((s, r) => s + parseN(r.revisedBudget), 0);
  const totalInitialBudget  = rows.reduce((s, r) => s + parseN(r.initialBudget), 0);
  const totalContractAmount = rows.reduce((s, r) => s + parseN(r.contractAmount), 0);
  const totalExpectedProfit = contractAmountFromProject - totalRevisedBudget;
  const { data: monitorData } = useMonitorData(projectId);
  const monitorItems = monitorData?.items ?? [];
  const orderAmount  = monitorItems.reduce((s, r) => s + r.orderedAmount, 0);
  const actualCost   = monitorItems.reduce((s, r) => s + r.actualCost, 0);
  const actualProfit = contractAmountFromProject - actualCost;

  const hasDirty = rows.some(r => r.isDirty || r.isNew);

  return (
    <div className="flex flex-col h-screen bg-slate-100">

      {/* ── 上部ナビゲーション ── */}
      <div className="bg-slate-700 text-white flex items-center gap-2 px-3 py-1.5 text-sm shrink-0">
        <Button variant="ghost" size="sm" className="text-white hover:bg-slate-600 h-7 px-2" asChild>
          <Link href={`/projects/${projectId}`}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            戻る
          </Link>
        </Button>
        <div className="h-4 w-px bg-slate-500 mx-1" />
        <Button variant="ghost" size="sm" className="text-white hover:bg-slate-600 h-7 px-2"
          onClick={() => queryClient.invalidateQueries({ queryKey: getListBudgetItemsQueryKey(projectId) })}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />更新
        </Button>
        <div className="flex-1" />
        <Button size="sm"
          className="bg-teal-600 hover:bg-teal-700 text-white h-7 px-4 font-bold"
          onClick={handleSave}
          disabled={saving}>
          <Save className="w-3.5 h-3.5 mr-1" />
          {saving ? "保存中..." : "保存する"}
        </Button>
        {hasDirty && <Badge className="bg-orange-500 text-white text-xs">未保存の変更あり</Badge>}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-3 space-y-2 min-w-[900px]">

          {/* ── タイトル ── */}
          <div className="text-center">
            <h1 className="text-xl font-bold text-teal-700 bg-white border border-teal-200 inline-block px-8 py-1 rounded">
              実行予算
            </h1>
          </div>

          {/* ── 表示設定エリア ── */}
          <div className="bg-white border border-slate-200 rounded p-2 flex flex-wrap gap-4 items-center text-sm">
            <span className="text-xs font-medium text-slate-500">表示設定</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setDisplayMode("contract")}
                className={`px-3 py-1 text-xs border rounded-l ${displayMode === "contract" ? "bg-slate-700 text-white border-slate-700" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                請負金額
              </button>
              <button onClick={() => setDisplayMode("progress")}
                className={`px-3 py-1 text-xs border rounded-r -ml-px ${displayMode === "progress" ? "bg-slate-700 text-white border-slate-700" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                出来高
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setProfitMode("profit")}
                className={`px-3 py-1 text-xs border rounded-l ${profitMode === "profit" ? "bg-slate-700 text-white border-slate-700" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                利益
              </button>
              <button onClick={() => setProfitMode("remaining")}
                className={`px-3 py-1 text-xs border rounded-r -ml-px ${profitMode === "remaining" ? "bg-slate-700 text-white border-slate-700" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                予算残
              </button>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-slate-500">集計区分：</span>
              <span className="text-xs font-semibold text-slate-700">税抜</span>
            </div>
          </div>

          {/* ── 工事情報バー ── */}
          <div className="bg-teal-700 text-white rounded px-3 py-1.5 flex items-center gap-3 text-xs">
            <span className="font-bold">工事</span>
            <span className="font-mono font-semibold">
              {project?.projectCode ?? "—"}
              {project?.projectCodeBranch ? ` - ${project.projectCodeBranch}` : ""}
            </span>
            <span className="font-medium">{project?.name ?? "—"}</span>
            {project?.siteManager && <span className="text-teal-200">{project.siteManager}</span>}
            <span className="ml-auto">
              進捗率 <strong>{project?.progressRate ?? 0}%</strong>
            </span>
            {project?.memo && (
              <span className="text-teal-200 truncate max-w-xs">{project.memo}</span>
            )}
          </div>

          {/* ── サマリーKPIバー ── */}
          <div className="grid grid-cols-6 border border-slate-300 rounded overflow-hidden text-sm">
            {[
              { label: "請負金額", value: contractAmountFromProject, pct: null, color: "bg-slate-600" },
              { label: "実行予算", value: totalRevisedBudget,       pct: pct(totalRevisedBudget, contractAmountFromProject), color: "bg-teal-700" },
              { label: "予定利益", value: totalExpectedProfit,      pct: pct(totalExpectedProfit, contractAmountFromProject), color: "bg-teal-600" },
              { label: "発注",     value: orderAmount,              pct: pct(orderAmount, contractAmountFromProject), color: "bg-blue-600" },
              { label: "原価",     value: actualCost,               pct: pct(actualCost, contractAmountFromProject), color: "bg-orange-600" },
              { label: "利益",     value: actualProfit,             pct: pct(actualProfit, contractAmountFromProject), color: "bg-emerald-600" },
            ].map(({ label, value, pct: p, color }) => (
              <div key={label} className={`${color} text-white text-center py-2`}>
                <div className="text-xs opacity-80 mb-0.5">{label}</div>
                <div className="font-bold text-sm leading-tight">
                  {formatCurrency(value)}
                  {p && <span className="text-xs font-normal ml-1 opacity-90">{p}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* ── タブ ── */}
          <Tabs defaultValue="budget" className="bg-white border border-slate-200 rounded">
            <TabsList className="border-b border-slate-200 rounded-none bg-slate-50 w-auto h-auto p-0">
              <TabsTrigger value="budget"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-teal-600 data-[state=active]:text-teal-700 data-[state=active]:bg-white text-sm px-4 py-2">
                実行予算登録
              </TabsTrigger>
              <TabsTrigger value="monitor"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-teal-600 data-[state=active]:text-teal-700 data-[state=active]:bg-white text-sm px-4 py-2">
                原価モニター
              </TabsTrigger>
            </TabsList>

            <TabsContent value="budget" className="p-0 m-0">
              {/* 操作ツールバー */}
              <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-100 bg-slate-50 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500 shrink-0">登録形式</span>
                  <Select value={regForm} onValueChange={setRegForm}>
                    <SelectTrigger className="h-7 text-xs w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="工種別仕入先毎">工種別仕入先毎</SelectItem>
                      <SelectItem value="工種別">工種別</SelectItem>
                      <SelectItem value="仕入先別">仕入先別</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500 shrink-0">予算入力</span>
                  <Select value={budgetInput} onValueChange={setBudgetInput}>
                    <SelectTrigger className="h-7 text-xs w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="すべて">すべて</SelectItem>
                      <SelectItem value="未入力のみ">未入力のみ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <Checkbox className="h-3.5 w-3.5"
                    checked={showExpectedProfit}
                    onCheckedChange={v => setShowExpectedProfit(!!v)} />
                  予定利益表示＊
                </label>

                {/* 表示設定コラプシブル */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowDisplaySettings(v => !v)}
                    className="flex items-center gap-1 px-2 py-1 text-xs border border-slate-300 rounded bg-white hover:bg-slate-50 text-slate-600"
                  >
                    <Settings2 className="w-3 h-3" />
                    表示設定
                    {showDisplaySettings ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </button>
                  {showDisplaySettings && (
                    <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-slate-200 rounded shadow-lg p-3 flex flex-col gap-2 min-w-[140px]">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                        <Checkbox className="h-3.5 w-3.5"
                          checked={showProgress}
                          onCheckedChange={v => setShowProgress(!!v)} />
                        進捗入力
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                        <Checkbox className="h-3.5 w-3.5"
                          checked={showTax}
                          onCheckedChange={v => setShowTax(!!v)} />
                        消費税入力
                      </label>
                    </div>
                  )}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <div className="relative group flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-7 text-xs px-2 ${rows.length > 0 ? "opacity-50 cursor-not-allowed border-slate-200 text-slate-400" : "border-blue-300 text-blue-700 hover:bg-blue-50"}`}
                      onClick={handleImportFromEstimate}
                      disabled={rows.length > 0 || importing}
                    >
                      <Download className="w-3.5 h-3.5 mr-1" />
                      {importing ? "取込み中..." : "見積書から取込"}
                    </Button>
                    {rows.length > 0 && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        当初予算は登録済みです
                      </span>
                    )}
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={handleAddRow}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> 行追加
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-red-600 border-red-200 hover:bg-red-50"
                    onClick={handleDeleteSelected}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> 行削除
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                    onClick={openBulkOrderModal}
                    disabled={computedVendorGroups.length === 0}
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    発注書を作成
                    {selectedRows.size > 0 && computedVendorGroups.length > 0 && (
                      <span className="ml-1 bg-white/20 rounded px-1">{computedVendorGroups.reduce((s,g)=>s+g.items.length,0)}行・{computedVendorGroups.length}社</span>
                    )}
                  </Button>
                </div>
              </div>

              {/* 明細テーブル */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-teal-700 text-white">
                      <th className="border border-teal-600 px-1 py-1.5 w-8 text-center" title="行を選択（削除・発注書作成に使用）">
                        <Checkbox className="h-3.5 w-3.5 border-white"
                          checked={selectedRows.size === rows.length && rows.length > 0}
                          onCheckedChange={v => setSelectedRows(v ? new Set(rows.map((_, i) => i)) : new Set())}
                        />
                      </th>
                      {COLS.filter(col => !col.hidden).map(col => (
                        <th key={col.key}
                          style={{ width: col.width, minWidth: col.width }}
                          className={`border border-teal-600 px-2 py-1.5 font-semibold ${col.align === "right" ? "text-right" : "text-left"}`}>
                          {col.label}
                        </th>
                      ))}
                      {showExpectedProfit && (
                        <>
                          <th className="border border-teal-600 px-2 py-1.5 text-right font-semibold" style={{ width: "110px" }}>予定利益</th>
                          <th className="border border-teal-600 px-2 py-1.5 text-right font-semibold" style={{ width: "80px" }}>予定利益率</th>
                        </>
                      )}
                      <th className="border border-teal-600 px-1 py-1.5 text-center" style={{ width: "36px" }} title="上の行を複写">複写</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td colSpan={COLS.length + 4} className="px-2 py-1.5">
                            <Skeleton className="h-4 w-full" />
                          </td>
                        </tr>
                      ))
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={COLS.length + 4} className="py-6 text-center text-slate-400 text-sm">
                          明細がありません。「行追加」から追加してください。
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, rowIdx) => {
                        const profit = parseN(row.contractAmount) - parseN(row.revisedBudget);
                        const ca = parseN(row.contractAmount);
                        const profitRate = ca > 0 ? ((profit / ca) * 100).toFixed(1) + "%" : "—";
                        const isSelected = selectedRows.has(rowIdx);
                        const isDirty = row.isDirty || row.isNew;
                        const isOrdered = !!row.purchaseOrderId;
                        const isOrderable = !isOrdered && !!row.vendorId;
                        return (
                          <tr key={rowIdx}
                            className={`border-b border-slate-100 hover:bg-teal-50/30 transition-colors
                              ${isSelected ? "bg-blue-50" : isDirty ? "bg-amber-50/40" : rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                            <td className="border border-slate-100 px-1 py-0.5 text-center">
                              <Checkbox className="h-3.5 w-3.5"
                                checked={isSelected}
                                
                                onCheckedChange={() => handleToggleRow(rowIdx)} />
                            </td>
                            {COLS.filter(col => !col.hidden).map(col => (
                              <td key={col.key}
                                className={`border border-slate-100 p-0 ${col.align === "right" ? "text-right" : ""}`}>
                                {col.key === "workTypeCode" ? (
                                  <Select
                                    value={row.workTypeName || "__none__"}
                                    onValueChange={name => {
                                      if (name === "__none__") {
                                        handleSelectWorkType(rowIdx, { id: 0, code: "", name: "" });
                                        return;
                                      }
                                      const wt = workTypes.find(w => w.name === name);
                                      if (wt) handleSelectWorkType(rowIdx, wt);
                                    }}
                                  >
                                    <SelectTrigger className="h-7 w-full border-0 rounded-none text-xs focus:ring-1 focus:ring-teal-400 focus:ring-inset" style={{ minHeight: "28px" }}>
                                      <SelectValue placeholder="工種を選択">
                                        {row.workTypeName ? (
                                          <span>{row.workTypeName}</span>
                                        ) : (
                                          <span className="text-slate-400">工種を選択</span>
                                        )}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__" className="text-xs text-slate-400">— 未選択 —</SelectItem>
                                      {workTypes.map(wt => (
                                        <SelectItem key={wt.id} value={wt.name} className="text-xs">
                                          {wt.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : col.key === "vendorId" ? (
                                  isOrdered ? (
                                    <div className="h-7 px-2 flex items-center gap-1.5 text-xs" style={{ minHeight: "28px" }}>
                                      <span className="truncate">{row.supplierName}</span>
                                      <Link href={`/purchase-orders/${row.purchaseOrderId}`}>
                                        <Badge className="text-[10px] px-1 py-0 h-4 bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200 cursor-pointer gap-0.5">
                                          <PackageCheck className="w-2.5 h-2.5" />発注済
                                        </Badge>
                                      </Link>
                                    </div>
                                  ) : (
                                  <div className="flex items-center gap-0.5">
                                  <Select
                                    value={row.vendorId || "__none__"}
                                    onValueChange={val => {
                                      if (val === "__none__") {
                                        setRows(prev => prev.map((r, i) =>
                                          i === rowIdx ? { ...r, vendorId: "", supplierName: "", isDirty: true } : r
                                        ));
                                      } else {
                                        handleSelectVendor(rowIdx, val);
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-7 flex-1 min-w-0 border-0 rounded-none text-xs focus:ring-1 focus:ring-teal-400 focus:ring-inset" style={{ minHeight: "28px" }}>
                                      <SelectValue placeholder="仕入先を選択">
                                        {row.vendorId ? (
                                          <span>{row.supplierName || vendors.find(v => String(v.id) === row.vendorId)?.name || ""}</span>
                                        ) : (
                                          <span className="text-slate-400">仕入先を選択</span>
                                        )}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      <div className="px-2 py-1.5 border-b border-slate-100">
                                        <input
                                          className="w-full text-xs outline-none bg-transparent placeholder:text-slate-400"
                                          placeholder="仕入先を検索..."
                                          value={vendorSearch}
                                          onChange={e => setVendorSearch(e.target.value)}
                                          onKeyDown={e => e.stopPropagation()}
                                        />
                                      </div>
                                      <SelectItem value="__none__" className="text-xs text-slate-400">— 未選択 —</SelectItem>
                                      {filteredVendors.map(v => (
                                        <SelectItem key={v.id} value={String(v.id)} className="text-xs">
                                          {v.code && <span className="font-mono text-slate-400 mr-1">{v.code}</span>}
                                          {v.name}
                                        </SelectItem>
                                      ))}
                                      <div className="border-t border-slate-100 mt-1 pt-1 px-2 pb-1">
                                        <button
                                          type="button"
                                          className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1"
                                          onMouseDown={e => {
                                            e.preventDefault();
                                            setPendingVendorRowIdx(rowIdx);
                                            setAddVendorOpen(true);
                                          }}
                                        >
                                          <Plus className="w-3 h-3" /> 新しい仕入先を登録
                                        </button>
                                      </div>
                                    </SelectContent>
                                  </Select>
                                  {/* 単価参照ボタン（仕入先選択済み時のみ表示） */}
                                  {row.vendorId && (
                                    <UnitPricePicker
                                      vendorId={row.vendorId}
                                      onSelect={(sel: UnitPriceSelection) => {
                                        setRows(prev => prev.map((r, i) => {
                                          if (i !== rowIdx) return r;
                                          const updated = { ...r, isDirty: true };
                                          // 工種が未選択なら単価マスタの工種をセット
                                          if (!r.workTypeCode && sel.workTypeCode) {
                                            const wt = workTypes.find(w => w.code === sel.workTypeCode);
                                            if (wt) {
                                              updated.workTypeCode = wt.code;
                                              updated.workTypeName = wt.name;
                                            }
                                          }
                                          // 実行予算に単価をセット
                                          updated.revisedBudget = sel.unitPrice;
                                          return updated;
                                        }));
                                      }}
                                    />
                                  )}
                                  </div>
                                  )
                                ) : (
                                  <input
                                    ref={el => { cellRefs.current[`${rowIdx}-${col.key}`] = el; }}
                                    type={col.numeric ? "number" : "text"}
                                    value={col.numeric && (row[col.key] === "0" || row[col.key] === 0) ? "" : row[col.key] as string}
                                    onChange={e => handleCellChange(rowIdx, col.key, e.target.value)}
                                    onKeyDown={e => handleKeyDown(e, rowIdx, col.key)}
                                    className={`w-full h-full px-2 py-1 bg-transparent outline-none focus:bg-teal-50 focus:ring-1 focus:ring-teal-400 text-xs
                                      ${col.numeric ? "text-right" : ""}
                                      ${col.key === "contractAmount" ? "text-slate-600" : ""}`}
                                    style={{ minHeight: "28px" }}
                                  />
                                )}
                              </td>
                            ))}
                            {showExpectedProfit && (
                              <>
                                <td className="border border-slate-100 px-2 py-1 text-right text-slate-700">
                                  {profit !== 0 ? profit.toLocaleString("ja-JP") : ""}
                                </td>
                                <td className={`border border-slate-100 px-2 py-1 text-right font-medium ${profit < 0 ? "text-red-600" : "text-slate-700"}`}>
                                  {profitRate}
                                </td>
                              </>
                            )}
                            <td className="border border-slate-100 px-1 py-0.5 text-center">
                              <button
                                type="button"
                                title="上の行を複写"
                                disabled={rowIdx === 0}
                                onClick={() => handleCopyRow(rowIdx)}
                                className={`p-1 rounded transition-colors ${rowIdx === 0 ? "text-slate-200 cursor-not-allowed" : "text-slate-400 hover:text-teal-600 hover:bg-teal-50"}`}
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {rows.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                        <td className="border border-slate-200 px-1 py-1.5" />
                        <td className="border border-slate-200 px-2 py-1.5" colSpan={2}>合計</td>
                        <td className="border border-slate-200 px-2 py-1.5 text-right">
                          {fmt(totalContractAmount)}
                        </td>
                        <td className="border border-slate-200 px-2 py-1.5 text-right">
                          {fmt(totalInitialBudget)}
                        </td>
                        <td className="border border-slate-200 px-2 py-1.5 text-right text-teal-700">
                          {fmt(totalRevisedBudget)}
                        </td>
                        {showExpectedProfit && (
                          <>
                            <td className="border border-slate-200 px-2 py-1.5 text-right text-slate-700">
                              {fmt(totalExpectedProfit)}
                            </td>
                            <td className={`border border-slate-200 px-2 py-1.5 text-right ${totalExpectedProfit < 0 ? "text-red-600" : "text-slate-700"}`}>
                              {pct(totalExpectedProfit, contractAmountFromProject)}
                            </td>
                          </>
                        )}
                        <td className="border border-slate-200 px-1 py-1.5" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </TabsContent>

            <TabsContent value="monitor" className="p-4 m-0">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">原価モニター</h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-600 text-white">
                        <th className="border border-slate-500 px-3 py-2 text-left">工種コード</th>
                        <th className="border border-slate-500 px-3 py-2 text-left">工種名</th>
                        <th className="border border-slate-500 px-3 py-2 text-right">実行予算</th>
                        <th className="border border-slate-500 px-3 py-2 text-right">発注済金額</th>
                        <th className="border border-slate-500 px-3 py-2 text-right">実績原価（仕入）</th>
                        <th className="border border-slate-500 px-3 py-2 text-right">予算残</th>
                        <th className="border border-slate-500 px-3 py-2 text-right">予算消化率</th>
                        <th className="border border-slate-500 px-3 py-2 text-right">予定利益</th>
                        <th className="border border-slate-500 px-3 py-2 text-right">予定利益率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monitorItems.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-6 text-center text-slate-400">
                            実行予算明細がありません
                          </td>
                        </tr>
                      ) : monitorItems.map((row, i) => {
                        const budgetRow = rows.find(r => r.workTypeCode === row.workTypeCode);
                        const ca = budgetRow ? parseN(budgetRow.contractAmount) : 0;
                        const profit = ca - row.revisedBudget;
                        const profitRate = ca > 0 ? (profit / ca * 100).toFixed(1) + "%" : "—";
                        return (
                          <tr key={i} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                            <td className="border border-slate-100 px-3 py-1.5">{row.workTypeCode}</td>
                            <td className="border border-slate-100 px-3 py-1.5">{row.workTypeName}</td>
                            <td className="border border-slate-100 px-3 py-1.5 text-right text-indigo-700">{row.revisedBudget.toLocaleString("ja-JP")}</td>
                            <td className="border border-slate-100 px-3 py-1.5 text-right text-blue-700">{row.orderedAmount > 0 ? row.orderedAmount.toLocaleString("ja-JP") : "—"}</td>
                            <td className="border border-slate-100 px-3 py-1.5 text-right text-orange-700">{row.actualCost > 0 ? row.actualCost.toLocaleString("ja-JP") : "—"}</td>
                            <td className={`border border-slate-100 px-3 py-1.5 text-right font-medium ${row.budgetRemaining < 0 ? "text-red-600" : "text-emerald-600"}`}>
                              {row.budgetRemaining.toLocaleString("ja-JP")}
                            </td>
                            <td className={`border border-slate-100 px-3 py-1.5 text-right font-medium ${(row.consumptionRate ?? 0) > 100 ? "text-red-600" : "text-slate-700"}`}>
                              {row.consumptionRate !== null ? row.consumptionRate.toFixed(1) + "%" : "—"}
                            </td>
                            <td className="border border-slate-100 px-3 py-1.5 text-right">{profit.toLocaleString("ja-JP")}</td>
                            <td className={`border border-slate-100 px-3 py-1.5 text-right font-medium ${profit < 0 ? "text-red-600" : "text-emerald-600"}`}>{profitRate}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {monitorItems.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-100 font-semibold">
                          <td className="border border-slate-300 px-3 py-1.5" colSpan={2}>合計</td>
                          <td className="border border-slate-300 px-3 py-1.5 text-right text-indigo-700">
                            {monitorItems.reduce((s, r) => s + r.revisedBudget, 0).toLocaleString("ja-JP")}
                          </td>
                          <td className="border border-slate-300 px-3 py-1.5 text-right text-blue-700">
                            {monitorItems.reduce((s, r) => s + r.orderedAmount, 0).toLocaleString("ja-JP")}
                          </td>
                          <td className="border border-slate-300 px-3 py-1.5 text-right text-orange-700">
                            {monitorItems.reduce((s, r) => s + r.actualCost, 0).toLocaleString("ja-JP")}
                          </td>
                          <td className={`border border-slate-300 px-3 py-1.5 text-right ${monitorItems.reduce((s, r) => s + r.budgetRemaining, 0) < 0 ? "text-red-600" : "text-emerald-600"}`}>
                            {monitorItems.reduce((s, r) => s + r.budgetRemaining, 0).toLocaleString("ja-JP")}
                          </td>
                          <td className="border border-slate-300 px-3 py-1.5 text-right text-slate-500">—</td>
                          <td className="border border-slate-300 px-3 py-1.5" colSpan={2}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </TabsContent>
          </Tabs>

        </div>
      </div>

      {/* ── 下部固定ボタンバー ── */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2 flex justify-end items-center gap-2">
        <Button variant="outline" asChild>
          <Link href={`/projects/${projectId}`}>キャンセル</Link>
        </Button>
        <Button className="bg-teal-600 hover:bg-teal-700" onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? "保存中..." : "保存する"}
        </Button>
      </div>

      {/* ── 一括発注書作成 ダイアログ ── */}
      <Dialog open={bulkOrderOpen} onOpenChange={open => { if (!open) setBulkOrderOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-600" />
              発注書を一括作成
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-slate-700 shrink-0">発注日</label>
              <Input
                type="date"
                value={orderDate}
                onChange={e => setOrderDate(e.target.value)}
                className="h-8 text-sm w-44"
              />
            </div>

            {/* 仕入先グループ別設定 */}
            <div className="space-y-2">
              {computedVendorGroups.map(grp => {
                const settings = vendorGroupSettings.get(grp.vendorId) ?? { deliveryDate: "", notes: "" };
                return (
                  <div key={grp.vendorId} className="border rounded overflow-hidden">
                    <div className="bg-slate-50 border-b px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-800">{grp.vendorName}</span>
                        <span className="text-xs text-slate-500">{grp.items.length}件</span>
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {grp.items.map(it => (
                          <li key={it.rowIdx} className="text-xs text-slate-600 flex justify-between">
                            <span>{it.workTypeName}</span>
                            <span className="font-mono">{it.revisedBudget.toLocaleString("ja-JP")}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="px-3 py-2 space-y-2 bg-white">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-500 w-12 shrink-0">納期</label>
                        <Input
                          type="date"
                          value={settings.deliveryDate}
                          onChange={e => {
                            setVendorGroupSettings(prev => {
                              const next = new Map(prev);
                              next.set(grp.vendorId, { ...settings, deliveryDate: e.target.value });
                              return next;
                            });
                          }}
                          className="h-7 text-xs w-40"
                        />
                      </div>
                      <div className="flex items-start gap-2">
                        <label className="text-xs text-slate-500 w-12 shrink-0 pt-1">備考</label>
                        <Input
                          value={settings.notes}
                          onChange={e => {
                            setVendorGroupSettings(prev => {
                              const next = new Map(prev);
                              next.set(grp.vendorId, { ...settings, notes: e.target.value });
                              return next;
                            });
                          }}
                          className="h-7 text-xs"
                          placeholder="発注書に記載する備考（任意）"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-slate-50 border rounded p-3 text-sm text-slate-600">
              <span className="font-semibold text-slate-800">{computedVendorGroups.length}社</span> の仕入先向けに
              <span className="font-semibold text-slate-800"> {computedVendorGroups.reduce((s,g)=>s+g.items.length,0)}件</span> の明細をまとめて発注書を作成します。
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOrderOpen(false)} disabled={bulkSubmitting}>
              キャンセル
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 gap-2"
              onClick={handleBulkCreate}
              disabled={bulkSubmitting}
            >
              {bulkSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
              発注書を作成する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 見積書選択ダイアログ ── */}
      <Dialog open={estimateDialogOpen} onOpenChange={setEstimateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>取込む見積書を選択</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto border rounded">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b text-xs text-slate-500">
                  <th className="px-3 py-2 text-left">見積番号</th>
                  <th className="px-3 py-2 text-left">工事名</th>
                  <th className="px-3 py-2 text-left">得意先</th>
                  <th className="px-3 py-2 text-left">見積日</th>
                  <th className="px-3 py-2 text-right">金額（税込）</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {allEstimates.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400">見積書がありません</td>
                  </tr>
                ) : allEstimates.map(e => (
                  <tr key={e.id} className="border-b hover:bg-teal-50">
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{e.estimateNumber}</td>
                    <td className="px-3 py-2 max-w-[180px] truncate">{e.subject || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{e.clientName || "—"}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{e.estimateDate}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(e.taxIncludedAmount)}</td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        className="h-6 text-xs bg-teal-600 hover:bg-teal-700"
                        onClick={async () => {
                          const confirmed = window.confirm(
                            `見積書 ${e.estimateNumber} の明細を当初予算として取込みます。よろしいですか？`
                          );
                          if (!confirmed) return;
                          setEstimateDialogOpen(false);
                          await doImport(e.id);
                        }}
                      >
                        取込む
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEstimateDialogOpen(false)}>キャンセル</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 新しい仕入先を登録 ダイアログ ── */}
      <Dialog open={addVendorOpen} onOpenChange={open => {
        setAddVendorOpen(open);
        if (!open) { setAddVendorName(""); setAddVendorCode(""); setPendingVendorRowIdx(null); }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新しい仕入先を登録</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-slate-700">仕入先名 <span className="text-red-500">*</span></label>
              <input
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400"
                value={addVendorName}
                onChange={e => setAddVendorName(e.target.value)}
                placeholder="例：○○工業株式会社"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">仕入先コード（任意）</label>
              <input
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"
                value={addVendorCode}
                onChange={e => setAddVendorCode(e.target.value)}
                placeholder="例：V001"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setAddVendorOpen(false); setAddVendorName(""); setAddVendorCode(""); setPendingVendorRowIdx(null); }}>
              キャンセル
            </Button>
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700"
              onClick={handleAddVendor}
              disabled={!addVendorName.trim() || addVendorSaving}
            >
              {addVendorSaving ? "登録中..." : "登録する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
