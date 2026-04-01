import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetProject, useGetProjectSummary, useListBudgetItems,
  useCreateBudgetItem, useUpdateBudgetItem, useDeleteBudgetItem,
  getGetProjectQueryKey, getGetProjectSummaryQueryKey,
  getListBudgetItemsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Save, Trash2, Plus, RefreshCw,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type RowState = {
  id?: number;
  workTypeCode: string;
  workTypeName: string;
  supplierCode: string;
  supplierName: string;
  contractAmount: string;
  initialBudget: string;
  revisedBudget: string;
  isDirty: boolean;
  isNew: boolean;
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

const COLS: { key: keyof RowState; label: string; width: string; align: "left" | "right"; numeric?: boolean }[] = [
  { key: "workTypeCode",   label: "工種コード",   width: "80px",  align: "left" },
  { key: "workTypeName",   label: "工種名",       width: "120px", align: "left" },
  { key: "supplierCode",   label: "仕入先コード", width: "90px",  align: "left" },
  { key: "supplierName",   label: "仕入先名",     width: "150px", align: "left" },
  { key: "contractAmount", label: "請負金額",     width: "110px", align: "right", numeric: true },
  { key: "initialBudget",  label: "当初予算",     width: "110px", align: "right", numeric: true },
  { key: "revisedBudget",  label: "実行予算",     width: "110px", align: "right", numeric: true },
];

export default function BudgetManagement() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const [rows, setRows] = useState<RowState[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const [displayMode, setDisplayMode] = useState<"contract" | "progress">("contract");
  const [profitMode, setProfitMode] = useState<"profit" | "remaining">("profit");
  const [showExpectedProfit, setShowExpectedProfit] = useState(true);
  const [regForm, setRegForm] = useState("工種別仕入先毎");
  const [budgetInput, setBudgetInput] = useState("すべて");

  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (budgetData?.items) {
      setRows(budgetData.items.map(item => ({
        id: item.id,
        workTypeCode: item.workTypeCode,
        workTypeName: item.workTypeName,
        supplierCode: item.supplierCode ?? "",
        supplierName: item.supplierName,
        contractAmount: String(item.contractAmount),
        initialBudget: String(item.initialBudget),
        revisedBudget: String(item.revisedBudget),
        isDirty: false,
        isNew: false,
      })));
      setSelectedRows(new Set());
    }
  }, [budgetData]);

  function handleCellChange(rowIdx: number, col: keyof RowState, value: string) {
    setRows(prev => prev.map((r, i) =>
      i === rowIdx ? { ...r, [col]: value, isDirty: true } : r
    ));
  }

  function handleAddRow() {
    const newRow: RowState = {
      workTypeCode: "", workTypeName: "",
      supplierCode: "", supplierName: "",
      contractAmount: "0", initialBudget: "0", revisedBudget: "0",
      isDirty: true, isNew: true,
    };
    setRows(prev => [...prev, newRow]);
    setTimeout(() => {
      const idx = rows.length;
      const ref = cellRefs.current[`${idx}-workTypeCode`];
      if (ref) ref.focus();
    }, 50);
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colKey: string) {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      if (rowIdx > 0) {
        const prev = rows[rowIdx - 1];
        setRows(old => old.map((r, i) =>
          i === rowIdx ? {
            ...r,
            workTypeCode: prev.workTypeCode,
            workTypeName: prev.workTypeName,
            supplierCode: prev.supplierCode,
            supplierName: prev.supplierName,
            contractAmount: prev.contractAmount,
            initialBudget: prev.initialBudget,
            revisedBudget: prev.revisedBudget,
            isDirty: true,
          } : r
        ));
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const colIdx = COLS.findIndex(c => c.key === colKey);
      let nextColIdx = colIdx + (e.shiftKey ? -1 : 1);
      let nextRowIdx = rowIdx;
      if (nextColIdx >= COLS.length) { nextColIdx = 0; nextRowIdx++; }
      if (nextColIdx < 0) { nextColIdx = COLS.length - 1; nextRowIdx--; }
      if (nextRowIdx >= 0 && nextRowIdx < rows.length) {
        const ref = cellRefs.current[`${nextRowIdx}-${COLS[nextColIdx].key}`];
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
      const data = {
        workTypeCode: row.workTypeCode || "—",
        workTypeName: row.workTypeName || "—",
        supplierCode: row.supplierCode,
        supplierName: row.supplierName,
        contractAmount: parseN(row.contractAmount),
        initialBudget: parseN(row.initialBudget),
        revisedBudget: parseN(row.revisedBudget),
        sortOrder: i,
      };
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
      toast({ title: "確定しました", description: "実行予算を保存しました。" });
    }
  }

  const totalContractAmount = rows.reduce((s, r) => s + parseN(r.contractAmount), 0);
  const totalInitialBudget  = rows.reduce((s, r) => s + parseN(r.initialBudget), 0);
  const totalRevisedBudget  = rows.reduce((s, r) => s + parseN(r.revisedBudget), 0);
  const totalExpectedProfit = totalContractAmount - totalRevisedBudget;
  const actualCost  = summary?.totalActualCost ?? 0;
  const actualProfit = totalContractAmount - actualCost;

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
          <RefreshCw className="w-3.5 h-3.5 mr-1" />F5 更新
        </Button>
        <div className="flex-1" />
        <Button size="sm"
          className="bg-teal-600 hover:bg-teal-700 text-white h-7 px-4 font-bold"
          onClick={handleSave}
          disabled={saving}>
          <Save className="w-3.5 h-3.5 mr-1" />
          {saving ? "保存中..." : "F12 確定"}
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
              { label: "請負金額",   value: totalContractAmount, pct: null,                    color: "bg-slate-600" },
              { label: "実行予算",   value: totalRevisedBudget,  pct: pct(totalRevisedBudget,  totalContractAmount), color: "bg-teal-700" },
              { label: "予定利益",   value: totalExpectedProfit, pct: pct(totalExpectedProfit, totalContractAmount), color: "bg-teal-600" },
              { label: "発注",       value: totalRevisedBudget,  pct: pct(totalRevisedBudget,  totalRevisedBudget || 1), color: "bg-blue-600" },
              { label: "原価",       value: actualCost,          pct: pct(actualCost,          totalContractAmount), color: "bg-orange-600" },
              { label: "利益",       value: actualProfit,        pct: pct(actualProfit,        totalContractAmount), color: "bg-emerald-600" },
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
                  <Checkbox className="h-3.5 w-3.5" /> 進捗入力
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <Checkbox className="h-3.5 w-3.5" /> 消費税入力
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <Checkbox className="h-3.5 w-3.5" defaultChecked
                    checked={showExpectedProfit}
                    onCheckedChange={v => setShowExpectedProfit(!!v)} />
                  予定利益表示＊
                </label>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={handleAddRow}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> 行追加
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-red-600 border-red-200 hover:bg-red-50"
                    onClick={handleDeleteSelected}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> 行削除
                  </Button>
                </div>
              </div>

              {/* 明細テーブル */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-teal-700 text-white">
                      <th className="border border-teal-600 px-1 py-1.5 w-8 text-center">
                        <Checkbox className="h-3.5 w-3.5 border-white"
                          checked={selectedRows.size === rows.length && rows.length > 0}
                          onCheckedChange={v => setSelectedRows(v ? new Set(rows.map((_, i) => i)) : new Set())}
                        />
                      </th>
                      {COLS.map(col => (
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
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td colSpan={COLS.length + 3} className="px-2 py-1.5">
                            <Skeleton className="h-4 w-full" />
                          </td>
                        </tr>
                      ))
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={COLS.length + 3} className="py-6 text-center text-slate-400 text-sm">
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
                        return (
                          <tr key={rowIdx}
                            className={`border-b border-slate-100 hover:bg-teal-50/30 transition-colors
                              ${isSelected ? "bg-blue-50" : isDirty ? "bg-amber-50/40" : rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                            <td className="border border-slate-100 px-1 py-0.5 text-center">
                              <Checkbox className="h-3.5 w-3.5"
                                checked={isSelected}
                                onCheckedChange={() => handleToggleRow(rowIdx)} />
                            </td>
                            {COLS.map(col => (
                              <td key={col.key}
                                className={`border border-slate-100 p-0 ${col.align === "right" ? "text-right" : ""}`}>
                                <input
                                  ref={el => { cellRefs.current[`${rowIdx}-${col.key}`] = el; }}
                                  type={col.numeric ? "number" : "text"}
                                  value={row[col.key] as string}
                                  onChange={e => handleCellChange(rowIdx, col.key, e.target.value)}
                                  onKeyDown={e => handleKeyDown(e, rowIdx, col.key)}
                                  className={`w-full h-full px-2 py-1 bg-transparent outline-none focus:bg-teal-50 focus:ring-1 focus:ring-teal-400 text-xs
                                    ${col.numeric ? "text-right" : ""}
                                    ${col.key === "contractAmount" ? "text-slate-600" : ""}`}
                                  style={{ minHeight: "28px" }}
                                />
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
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {rows.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                        <td className="border border-slate-200 px-1 py-1.5" />
                        <td className="border border-slate-200 px-2 py-1.5" colSpan={4}>合計</td>
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
                              {pct(totalExpectedProfit, totalContractAmount)}
                            </td>
                          </>
                        )}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* フッターヒント */}
              <div className="px-3 py-2 text-xs text-slate-500 border-t border-slate-100 bg-slate-50">
                工種コードを入力してください。上項目複写：Ctrl+Enter
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
                        <th className="border border-slate-500 px-3 py-2 text-right">予定利益</th>
                        <th className="border border-slate-500 px-3 py-2 text-right">予定利益率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-400">
                            実行予算明細がありません
                          </td>
                        </tr>
                      ) : rows.map((row, i) => {
                        const rb = parseN(row.revisedBudget);
                        const ca = parseN(row.contractAmount);
                        const profit = ca - rb;
                        const rate = ca > 0 ? (profit / ca * 100).toFixed(1) + "%" : "—";
                        return (
                          <tr key={i} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                            <td className="border border-slate-100 px-3 py-1.5">{row.workTypeCode}</td>
                            <td className="border border-slate-100 px-3 py-1.5">{row.workTypeName}</td>
                            <td className="border border-slate-100 px-3 py-1.5 text-right text-indigo-700">{rb.toLocaleString("ja-JP")}</td>
                            <td className="border border-slate-100 px-3 py-1.5 text-right">{profit.toLocaleString("ja-JP")}</td>
                            <td className={`border border-slate-100 px-3 py-1.5 text-right font-medium ${profit < 0 ? "text-red-600" : "text-emerald-600"}`}>{rate}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          </Tabs>

        </div>
      </div>

      {/* ── 下部固定ボタンバー ── */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2 flex justify-between items-center">
        <span className="text-xs text-slate-500">
          工種コードを入力してください。上項目複写：Ctrl+Enter
        </span>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/projects/${projectId}`}>キャンセル</Link>
          </Button>
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "保存中..." : "F12 確定"}
          </Button>
        </div>
      </div>

    </div>
  );
}
