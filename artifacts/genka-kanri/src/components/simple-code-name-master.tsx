import { useState, useEffect, type ComponentType } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHighlightNew } from "@/hooks/use-highlight-new";
import { cn } from "@/lib/utils";

/**
 * 「コード＋名称」だけの小さなマスタ画面の共通コンポーネント。
 * 工事分類マスタ・担当者マスタで使用（今後も同型マスタが増えたらこれを使う）。
 */

export interface CodeNameRow {
  id: number;
  code: string;
  name: string;
}

interface SimpleCodeNameMasterProps {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  apiPath: string; // 例: "/api/construction-categories"
  queryKey: QueryKey; // 共通フックと同じキーを渡す（1キー=1形）
  rows: CodeNameRow[];
  isLoading: boolean;
  entityLabel: string; // 例: "工事分類"
  nameLabel: string; // 例: "名称" / "名前"
  namePlaceholder?: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SimpleCodeNameMaster({
  title,
  description,
  icon: Icon,
  apiPath,
  queryKey,
  rows,
  isLoading,
  entityLabel,
  nameLabel,
  namePlaceholder,
}: SimpleCodeNameMasterProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mark, isNew } = useHighlightNew();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CodeNameRow | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (dialogOpen) {
      setCode(editing?.code ?? "");
      setName(editing?.name ?? "");
    }
  }, [dialogOpen, editing]);

  const save = useMutation({
    mutationFn: async () => {
      const url = editing ? `${BASE}${apiPath}/${editing.id}` : `${BASE}${apiPath}`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), name: name.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "保存に失敗しました");
      return body as CodeNameRow;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey });
      toast({ title: editing ? "更新しました" : "登録しました" });
      if (row?.id) mark(row.id);
      setDialogOpen(false);
    },
    onError: (err) => {
      toast({
        title: "エラー",
        description: err instanceof Error ? err.message : "保存に失敗しました",
        variant: "destructive",
      });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}${apiPath}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "削除しました" });
    },
    onError: () => {
      toast({ title: "エラー", description: "削除に失敗しました", variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!code.trim() || !name.trim()) {
      toast({ title: "入力エラー", description: `コードと${nameLabel}は必須です`, variant: "destructive" });
      return;
    }
    save.mutate();
  };

  const handleDelete = (row: CodeNameRow) => {
    if (!window.confirm(`「${row.name}」を削除してもよいですか？`)) return;
    remove.mutate(row.id);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Icon className="w-6 h-6 text-primary" />
            {title}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{description}</p>
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
                <TableHead className="w-28">コード</TableHead>
                <TableHead>{nameLabel}</TableHead>
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
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-slate-400">
                    {entityLabel}が登録されていません
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} data-row-id={row.id} className={cn(isNew(row.id) && "highlight-new")}>
                    <TableCell className="font-mono text-sm">{row.code}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => { setEditing(row); setDialogOpen(true); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(row)}
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

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `${entityLabel}編集` : `${entityLabel}新規登録`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>コード <span className="text-destructive">*</span></Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>{nameLabel} <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={namePlaceholder} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
