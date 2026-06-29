import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Layers, Plus, Pencil, Trash2, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHighlightNew } from "@/hooks/use-highlight-new";
import { cn } from "@/lib/utils";

interface VendorGroup {
  id: number;
  name: string;
  notes: string | null;
  createdAt: string;
}

function useVendorGroups() {
  return useQuery({
    queryKey: ["/api/vendor-groups"],
    queryFn: async () => {
      const res = await fetch("/api/vendor-groups");
      if (!res.ok) throw new Error("Failed to fetch vendor groups");
      return res.json() as Promise<{ items: VendorGroup[]; total: number }>;
    },
  });
}

function useCreateVendorGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; notes?: string }) => {
      const res = await fetch("/api/vendor-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vendor-groups"] }),
  });
}

function useUpdateVendorGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number; name: string; notes?: string }) => {
      const res = await fetch(`/api/vendor-groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vendor-groups"] }),
  });
}

function useDeleteVendorGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/vendor-groups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vendor-groups"] }),
  });
}

interface GroupFormDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: VendorGroup | null;
  onSaved?: (id: number) => void;
}

function GroupFormDialog({ open, onClose, initial, onSaved }: GroupFormDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const create = useCreateVendorGroup();
  const update = useUpdateVendorGroup();
  const isPending = create.isPending || update.isPending;

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setNotes(initial?.notes ?? "");
    }
  }, [open, initial]);

  const handleClose = () => {
    onClose();
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "入力エラー", description: "グループ名は必須です", variant: "destructive" });
      return;
    }
    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, name: name.trim(), notes: notes.trim() || undefined });
        toast({ title: "更新しました" });
        onSaved?.(initial.id);
      } else {
        const created = await create.mutateAsync({ name: name.trim(), notes: notes.trim() || undefined });
        toast({ title: "登録しました" });
        onSaved?.(created?.id);
      }
      handleClose();
    } catch {
      toast({ title: "エラー", description: "保存に失敗しました", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "グループ編集" : "グループ新規登録"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>グループ名 <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 木工業者グループ" className="mt-1" />
          </div>
          <div>
            <Label>備考</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="メモ" className="mt-1 resize-none" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>キャンセル</Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VendorGroups() {
  const { toast } = useToast();
  const { data, isLoading } = useVendorGroups();
  const deleteGroup = useDeleteVendorGroup();
  const { mark, isNew } = useHighlightNew();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VendorGroup | null>(null);

  const handleDelete = async (g: VendorGroup) => {
    if (!window.confirm(`「${g.name}」を削除してもよいですか？`)) return;
    try {
      await deleteGroup.mutateAsync(g.id);
      toast({ title: "削除しました" });
    } catch {
      toast({ title: "エラー", description: "削除に失敗しました", variant: "destructive" });
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />
            仕入先グループマスタ
          </h1>
          <p className="text-sm text-slate-500 mt-1">仕入先をグループで管理します。</p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          新規登録
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>グループ名</TableHead>
                <TableHead>備考</TableHead>
                <TableHead className="w-24 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />読み込み中...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-slate-400">
                    グループが登録されていません
                  </TableCell>
                </TableRow>
              ) : (
                items.map((g) => (
                  <TableRow key={g.id} data-row-id={g.id} className={cn(isNew(g.id) && "highlight-new")}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="text-slate-500 text-sm">{g.notes ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => { setEditing(g); setDialogOpen(true); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(g)}
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

      <GroupFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        onSaved={mark}
      />
    </div>
  );
}
