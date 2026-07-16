import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useHighlightNew } from "@/hooks/use-highlight-new";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, Loader2, Users } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Client {
  id: number;
  clientCode: string;
  name: string;
  kana: string | null;
  address: string | null;
  tel: string | null;
  contactName: string | null;
  createdAt: string;
}

const QUERY_KEY = ["/api/clients"];

async function fetchClients(): Promise<{ items: Client[] }> {
  const res = await fetch(`${BASE}/api/clients`);
  if (!res.ok) throw new Error("Failed to fetch clients");
  return res.json();
}

type FormValues = {
  clientCode: string;
  name: string;
  kana: string;
  address: string;
  tel: string;
  contactName: string;
};

const defaultForm: FormValues = {
  clientCode: "",
  name: "",
  kana: "",
  address: "",
  tel: "",
  contactName: "",
};

export default function ClientMaster() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { mark, isNew } = useHighlightNew();

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchClients,
  });

  const clients = data?.items ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Client | null>(null);
  const [form, setForm] = useState<FormValues>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function openCreate() {
    setEditingItem(null);
    setForm(defaultForm);
    setDialogOpen(true);
  }

  function openEdit(item: Client) {
    setEditingItem(item);
    setForm({
      clientCode: item.clientCode,
      name: item.name,
      kana: item.kana ?? "",
      address: item.address ?? "",
      tel: item.tel ?? "",
      contactName: item.contactName ?? "",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingItem(null);
    setForm(defaultForm);
  }

  async function handleSubmit() {
    if (!form.clientCode.trim() || !form.name.trim()) {
      toast({ title: "入力エラー", description: "得意先コードと得意先名は必須です。", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        clientCode: form.clientCode.trim(),
        name: form.name.trim(),
        kana: form.kana.trim() || null,
        address: form.address.trim() || null,
        tel: form.tel.trim() || null,
        contactName: form.contactName.trim() || null,
      };

      if (editingItem) {
        const res = await fetch(`${BASE}/api/clients/${editingItem.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message ?? "更新に失敗しました");
        }
        toast({ title: "更新しました", description: `${form.name} を更新しました。` });
        mark(editingItem.id);
      } else {
        const res = await fetch(`${BASE}/api/clients`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message ?? "登録に失敗しました");
        }
        const created = await res.json().catch(() => null);
        toast({ title: "登録しました", description: `${form.name} を登録しました。` });
        mark(created?.id);
      }

      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      closeDialog();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "操作に失敗しました。";
      toast({ title: "エラー", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: Client) {
    if (!window.confirm(`「${item.name}」を削除してもよいですか？`)) return;
    setDeletingId(item.id);
    try {
      const res = await fetch(`${BASE}/api/clients/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("削除に失敗しました");
      toast({ title: "削除しました", description: `${item.name} を削除しました。` });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch {
      toast({ title: "削除エラー", description: "削除に失敗しました。", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-teal-700 text-white p-2 rounded-lg">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">得意先マスタ</h1>
            <p className="text-sm text-slate-500">得意先の登録・編集・削除</p>
          </div>
        </div>
        <Button
          className="bg-teal-700 hover:bg-teal-800 text-white gap-1.5"
          onClick={openCreate}
        >
          <Plus className="w-4 h-4" />
          新規登録
        </Button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-teal-700">
              <TableHead className="text-white font-semibold w-[120px]">得意先コード</TableHead>
              <TableHead className="text-white font-semibold">得意先名</TableHead>
              <TableHead className="text-white font-semibold">住所</TableHead>
              <TableHead className="text-white font-semibold w-[130px]">TEL</TableHead>
              <TableHead className="text-white font-semibold w-[120px]">担当者名</TableHead>
              <TableHead className="text-white font-semibold w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6} className="h-12">
                    <div className="h-4 bg-slate-100 rounded animate-pulse w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-slate-400 text-sm">
                  得意先が登録されていません。「新規登録」から追加してください。
                </TableCell>
              </TableRow>
            ) : (
              clients.map((client) => (
                <TableRow key={client.id} data-row-id={client.id} className={cn("hover:bg-slate-50", isNew(client.id) && "highlight-new")}>
                  <TableCell className="font-mono text-sm text-slate-600">{client.clientCode}</TableCell>
                  <TableCell className="font-medium text-slate-900">{client.name}</TableCell>
                  <TableCell className="text-sm text-slate-600">{client.address ?? "—"}</TableCell>
                  <TableCell className="text-sm text-slate-600">{client.tel ?? "—"}</TableCell>
                  <TableCell className="text-sm text-slate-600">{client.contactName ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-slate-500 hover:text-teal-700"
                        onClick={() => openEdit(client)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-slate-500 hover:text-destructive"
                        onClick={() => handleDelete(client)}
                        disabled={deletingId === client.id}
                      >
                        {deletingId === client.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem ? "得意先を編集" : "得意先を新規登録"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                得意先コード <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="例: C001"
                value={form.clientCode}
                onChange={(e) => setForm((f) => ({ ...f, clientCode: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                得意先名 <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="例: エステート住建株式会社"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">フリガナ</label>
              <Input
                placeholder="例: ｴｽﾃｰﾄｼﾞｭｳｹﾝ（プルダウンの読みがな検索に使われます）"
                value={form.kana}
                onChange={(e) => setForm((f) => ({ ...f, kana: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">住所</label>
              <Input
                placeholder="例: 宮城県仙台市青葉区1-2-3"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">TEL</label>
              <Input
                placeholder="例: 022-123-4567"
                value={form.tel}
                onChange={(e) => setForm((f) => ({ ...f, tel: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">担当者名</label>
              <Input
                placeholder="例: 田中 太郎"
                value={form.contactName}
                onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              キャンセル
            </Button>
            <Button
              className="bg-teal-700 hover:bg-teal-800 text-white"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              {editingItem ? "更新する" : "登録する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
