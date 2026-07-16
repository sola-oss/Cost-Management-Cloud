import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useHighlightNew } from "@/hooks/use-highlight-new";
import { useVendors } from "@/hooks/use-vendors";
import { useWorkTypes } from "@/hooks/use-work-types";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, Loader2, DollarSign, Search } from "lucide-react";

/* ── 型定義 ── */
interface UnitPriceRow {
  id: number;
  vendorId: number;
  workTypeId: number | null;
  itemName: string;
  unit: string;
  unitPrice: string;
  notes: string | null;
  vendorName: string | null;
  workTypeName: string | null;
  workTypeCode: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Vendor {
  id: number;
  name: string;
}

interface WorkType {
  id: number;
  code: string;
  name: string;
}

/* ── フェッチャ ── */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchUnitPrices(vendorId?: string, workTypeId?: string, q?: string): Promise<{ items: UnitPriceRow[]; total: number }> {
  const params = new URLSearchParams();
  if (vendorId) params.set("vendorId", vendorId);
  if (workTypeId) params.set("workTypeId", workTypeId);
  if (q) params.set("q", q);
  const res = await fetch(`${BASE}/api/unit-prices?${params}`);
  if (!res.ok) throw new Error("Failed to fetch unit prices");
  return res.json();
}

/* ── フォーム型 ── */
type FormValues = {
  vendorId: string;
  workTypeId: string;
  itemName: string;
  unit: string;
  unitPrice: string;
  notes: string;
};

const defaultForm: FormValues = {
  vendorId: "",
  workTypeId: "",
  itemName: "",
  unit: "式",
  unitPrice: "",
  notes: "",
};

const COMMON_UNITS = ["式", "m", "m2", "m3", "kg", "t", "本", "枚", "台", "個", "セット", "人工", "一式"] as const;

function fmtMoney(v: string | number): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("ja-JP");
}

/* ── コンポーネント ── */
export default function UnitPriceMaster() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mark, isNew } = useHighlightNew();

  // フィルタ
  const [filterVendorId, setFilterVendorId] = useState("");
  const [filterWorkTypeId, setFilterWorkTypeId] = useState("");
  const [filterQ, setFilterQ] = useState("");

  const QUERY_KEY = ["/api/unit-prices", filterVendorId, filterWorkTypeId, filterQ];

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchUnitPrices(filterVendorId, filterWorkTypeId, filterQ),
  });

  const { data: vendors = [] } = useVendors<Vendor>();

  const { data: workTypes = [] } = useWorkTypes<WorkType>();

  const items = data?.items ?? [];

  // ダイアログ
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<UnitPriceRow | null>(null);
  const [form, setForm] = useState<FormValues>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function openCreate() {
    setEditingItem(null);
    setForm(defaultForm);
    setDialogOpen(true);
  }

  function openEdit(item: UnitPriceRow) {
    setEditingItem(item);
    setForm({
      vendorId: String(item.vendorId),
      workTypeId: item.workTypeId ? String(item.workTypeId) : "",
      itemName: item.itemName,
      unit: item.unit,
      unitPrice: item.unitPrice,
      notes: item.notes ?? "",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingItem(null);
    setForm(defaultForm);
  }

  async function handleSubmit() {
    if (!form.vendorId) {
      toast({ title: "入力エラー", description: "仕入先は必須です。", variant: "destructive" });
      return;
    }
    if (!form.itemName.trim()) {
      toast({ title: "入力エラー", description: "品目名は必須です。", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        vendorId: Number(form.vendorId),
        workTypeId: form.workTypeId ? Number(form.workTypeId) : null,
        itemName: form.itemName.trim(),
        unit: form.unit || "式",
        unitPrice: form.unitPrice || "0",
        notes: form.notes.trim() || null,
      };

      if (editingItem) {
        const res = await fetch(`${BASE}/api/unit-prices/${editingItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message ?? "更新に失敗しました");
        }
        toast({ title: "更新しました" });
        mark(editingItem.id);
      } else {
        const post = (forceUpdate: boolean) =>
          fetch(`${BASE}/api/unit-prices`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, forceUpdate }),
          });
        let res = await post(false);
        let data = await res.json().catch(() => ({}));

        // 同じ仕入先・工種・品名で単価違いが既にある場合は上書き確認
        if (res.status === 409 && data?.status === "conflict") {
          const oldPrice = Number(data.existing?.unitPrice ?? 0);
          const newPrice = Number(form.unitPrice || 0);
          const ok = window.confirm(
            `「${form.itemName.trim()}」は既に ${oldPrice.toLocaleString()}円 で登録されています。\n` +
            `${newPrice.toLocaleString()}円 に更新しますか？`,
          );
          if (!ok) { setSubmitting(false); return; }
          res = await post(true);
          data = await res.json().catch(() => ({}));
        }
        if (!res.ok) throw new Error(data.message ?? "登録に失敗しました");
        toast({
          title:
            data?.status === "unchanged" ? "登録済みです（同じ単価）" :
            data?.status === "updated" ? "単価を更新しました" : "登録しました",
        });
        mark(data?.row?.id);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/unit-prices"] });
      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "予期しないエラーが発生しました";
      toast({ title: "エラー", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: UnitPriceRow) {
    if (!window.confirm(`「${item.vendorName} / ${item.itemName}」を削除してもよいですか？`)) return;
    setDeletingId(item.id);
    try {
      const res = await fetch(`${BASE}/api/unit-prices/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "削除に失敗しました");
      }
      toast({ title: "削除しました" });
      queryClient.invalidateQueries({ queryKey: ["/api/unit-prices"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "予期しないエラーが発生しました";
      toast({ title: "削除エラー", description: message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      {/* ── ページヘッダー ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-700 text-white p-2 rounded-md">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">単価マスタ</h1>
            <p className="text-xs text-slate-500 mt-0.5">仕入先別・品目別の単価を管理</p>
          </div>
        </div>
        <Button
          className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
          onClick={openCreate}
        >
          <Plus className="w-4 h-4" />
          新規登録
        </Button>
      </div>

      {/* ── フィルタ ── */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">仕入先</Label>
            <Select value={filterVendorId} onValueChange={setFilterVendorId}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="すべて" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)} className="text-sm">{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">工種</Label>
            <Select value={filterWorkTypeId} onValueChange={setFilterWorkTypeId}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="すべて" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {workTypes.map((wt) => (
                  <SelectItem key={wt.id} value={String(wt.id)} className="text-sm">
                    {wt.code} {wt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">品目名で検索</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <Input
                className="pl-8 text-sm"
                placeholder="品目名を入力..."
                value={filterQ}
                onChange={(e) => setFilterQ(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── テーブル ── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="bg-indigo-700 px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-semibold text-white">単価一覧</span>
          <span className="text-xs text-indigo-200">{items.length} 件</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 text-xs">
                <TableHead className="font-semibold text-slate-600">仕入先</TableHead>
                <TableHead className="font-semibold text-slate-600">工種</TableHead>
                <TableHead className="font-semibold text-slate-600">品目名</TableHead>
                <TableHead className="w-[80px] font-semibold text-slate-600">単位</TableHead>
                <TableHead className="w-[120px] font-semibold text-slate-600 text-right">単価</TableHead>
                <TableHead className="font-semibold text-slate-600">備考</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <div className="h-8 bg-slate-100 rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                    単価が登録されていません。「新規登録」から追加してください。
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} data-row-id={item.id} className={cn("hover:bg-slate-50/60", isNew(item.id) && "highlight-new")}>
                    <TableCell className="text-sm font-medium text-slate-800">
                      {item.vendorName ?? "—"}
                    </TableCell>
                    <TableCell>
                      {item.workTypeName ? (
                        <Badge variant="outline" className="text-xs bg-slate-50">
                          {item.workTypeCode} {item.workTypeName}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {item.itemName}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {item.unit}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-right font-medium text-slate-800">
                      {fmtMoney(item.unitPrice)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-xs truncate">
                      {item.notes || <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-slate-400 hover:text-indigo-600"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-slate-400 hover:text-red-500"
                          onClick={() => handleDelete(item)}
                          disabled={deletingId === item.id}
                        >
                          {deletingId === item.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />
                          }
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── 登録・編集ダイアログ ── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-indigo-700">
              {editingItem ? "単価を編集" : "単価を新規登録"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">
                仕入先 <span className="text-red-500">*</span>
              </Label>
              <Select
                value={form.vendorId}
                onValueChange={(v) => setForm((f) => ({ ...f, vendorId: v }))}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="仕入先を選択" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)} className="text-sm">{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">工種</Label>
              <Select
                value={form.workTypeId}
                onValueChange={(v) => setForm((f) => ({ ...f, workTypeId: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="工種を選択（任意）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-sm">指定なし</SelectItem>
                  {workTypes.map((wt) => (
                    <SelectItem key={wt.id} value={String(wt.id)} className="text-sm">
                      {wt.code} {wt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">
                品目名 <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.itemName}
                onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))}
                placeholder="例: 構造用合板 12mm"
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">単位</Label>
                <Select
                  value={form.unit}
                  onValueChange={(v) => setForm((f) => ({ ...f, unit: v }))}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_UNITS.map((u) => (
                      <SelectItem key={u} value={u} className="text-sm">{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">
                  単価（円）
                </Label>
                <Input
                  type="number"
                  value={form.unitPrice}
                  onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
                  placeholder="0"
                  className="text-sm text-right"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">備考</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="備考・説明（任意）"
                className="text-sm resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              キャンセル
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-1" />処理中...</>
              ) : editingItem ? "更新する" : "登録する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
