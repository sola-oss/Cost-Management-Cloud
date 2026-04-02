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
import { Plus, Pencil, Trash2, Loader2, Wrench } from "lucide-react";

interface WorkType {
  id: number;
  code: string;
  name: string;
  constructionType: string;
  notes: string | null;
  createdAt: string;
}

const CONSTRUCTION_TYPES = ["建築", "土木", "設備", "その他"] as const;

const CONSTRUCTION_TYPE_COLORS: Record<string, string> = {
  "建築": "bg-blue-100 text-blue-700 border-blue-200",
  "土木": "bg-amber-100 text-amber-700 border-amber-200",
  "設備": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "その他": "bg-slate-100 text-slate-700 border-slate-200",
};

const QUERY_KEY = ["/api/work-types"];

async function fetchWorkTypes(): Promise<WorkType[]> {
  const res = await fetch("/api/work-types");
  if (!res.ok) throw new Error("Failed to fetch work types");
  return res.json();
}

type FormValues = {
  name: string;
  constructionType: string;
  notes: string;
};

const defaultForm: FormValues = {
  name: "",
  constructionType: "建築",
  notes: "",
};

export default function WorkTypeMaster() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: workTypes = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchWorkTypes,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkType | null>(null);
  const [form, setForm] = useState<FormValues>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function openCreate() {
    setEditingItem(null);
    setForm(defaultForm);
    setDialogOpen(true);
  }

  function openEdit(item: WorkType) {
    setEditingItem(item);
    setForm({
      name: item.name,
      constructionType: item.constructionType,
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
    if (!form.name.trim()) {
      toast({ title: "入力エラー", description: "工種名は必須です。", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      if (editingItem) {
        const res = await fetch(`/api/work-types/${editingItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            constructionType: form.constructionType,
            notes: form.notes.trim() || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message ?? "更新に失敗しました");
        }
        toast({ title: "更新しました" });
      } else {
        const res = await fetch("/api/work-types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            constructionType: form.constructionType,
            notes: form.notes.trim() || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message ?? "登録に失敗しました");
        }
        toast({ title: "登録しました" });
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "予期しないエラーが発生しました";
      toast({ title: "エラー", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: WorkType) {
    if (!window.confirm(`「${item.name}」を削除してもよいですか？`)) return;
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/work-types/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "削除に失敗しました");
      }
      toast({ title: "削除しました" });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (err) {
      const message = err instanceof Error ? err.message : "予期しないエラーが発生しました";
      toast({ title: "削除エラー", description: message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {/* ── ページヘッダー ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-teal-700 text-white p-2 rounded-md">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">工種マスタ</h1>
            <p className="text-xs text-slate-500 mt-0.5">工種の一覧管理・新規登録・編集・削除</p>
          </div>
        </div>
        <Button
          className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5"
          onClick={openCreate}
        >
          <Plus className="w-4 h-4" />
          新規登録
        </Button>
      </div>

      {/* ── テーブル ── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="bg-teal-700 px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-semibold text-white">工種一覧</span>
          <span className="text-xs text-teal-200">{workTypes.length} 件</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 text-xs">
                <TableHead className="w-[100px] font-semibold text-slate-600">工種コード</TableHead>
                <TableHead className="font-semibold text-slate-600">工種名</TableHead>
                <TableHead className="w-[120px] font-semibold text-slate-600">工事区分</TableHead>
                <TableHead className="font-semibold text-slate-600">備考</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <div className="h-8 bg-slate-100 rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : workTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-slate-400 text-sm">
                    工種が登録されていません。「新規登録」から追加してください。
                  </TableCell>
                </TableRow>
              ) : (
                workTypes.map((item) => (
                  <TableRow key={item.id} className="hover:bg-slate-50/60">
                    <TableCell className="text-xs font-mono text-slate-600 font-medium">
                      {item.code}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-slate-800">
                      {item.name}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${CONSTRUCTION_TYPE_COLORS[item.constructionType] ?? CONSTRUCTION_TYPE_COLORS["その他"]}`}
                      >
                        {item.constructionType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-xs truncate">
                      {item.notes || <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-slate-400 hover:text-teal-600"
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-teal-700">
              {editingItem ? "工種を編集" : "工種を新規登録"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">
                工種名 <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例: 仮設工事"
                className="text-sm"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">工事区分</Label>
              <Select
                value={form.constructionType}
                onValueChange={(v) => setForm((f) => ({ ...f, constructionType: v }))}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONSTRUCTION_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct} className="text-sm">
                      {ct}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">備考</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="備考・説明（任意）"
                className="text-sm resize-none"
                rows={3}
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
