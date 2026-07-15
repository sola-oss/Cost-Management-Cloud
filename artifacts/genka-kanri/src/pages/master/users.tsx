import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { UserCog, Plus, Pencil, Trash2, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHighlightNew } from "@/hooks/use-highlight-new";
import { useAuthStatus } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

interface AppUser {
  id: number;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const USERS_QUERY_KEY = ["/api/users"];

function useUsers() {
  return useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/users`);
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json() as Promise<{ items: AppUser[]; total: number }>;
    },
  });
}

export function UserFormDialog({
  open,
  onClose,
  initial,
  initialName,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial?: AppUser | null;
  /** 新規作成時に名前欄へ初期セットする値（担当者マスタからの「ログイン発行」用） */
  initialName?: string;
  onSaved?: (id: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? initialName ?? "");
      setEmail(initial?.email ?? "");
      setPassword("");
    }
  }, [open, initial, initialName]);

  const save = useMutation({
    mutationFn: async () => {
      const url = initial ? `${BASE}/api/users/${initial.id}` : `${BASE}/api/users`;
      const body: Record<string, string> = { name: name.trim(), email: email.trim() };
      if (password) body.password = password;
      const res = await fetch(url, {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? "保存に失敗しました");
      return data as AppUser;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      toast({
        title: initial ? "更新しました" : "登録しました",
        description: !initial || password ? "パスワードを本人に伝え、初回ログイン後に変更してもらってください" : undefined,
      });
      if (row?.id) onSaved?.(row.id);
      onClose();
    },
    onError: (err) => {
      toast({
        title: "エラー",
        description: err instanceof Error ? err.message : "保存に失敗しました",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!name.trim() || !email.trim()) {
      toast({ title: "入力エラー", description: "名前とメールアドレスは必須です", variant: "destructive" });
      return;
    }
    if (!initial && !password) {
      toast({ title: "入力エラー", description: "初期パスワードを入力してください", variant: "destructive" });
      return;
    }
    if (password && password.length < 8) {
      toast({ title: "入力エラー", description: "パスワードは8文字以上にしてください", variant: "destructive" });
      return;
    }
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "ユーザー編集" : "ユーザー新規登録"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>名前 <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 山口 太郎" className="mt-1" />
          </div>
          <div>
            <Label>メールアドレス（ログインID） <span className="text-destructive">*</span></Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="taro@example.com" className="mt-1" />
          </div>
          <div>
            <Label>
              {initial ? "新しいパスワード（変更する場合のみ）" : <>初期パスワード <span className="text-destructive">*</span></>}
            </Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={initial ? "空欄なら変更しません" : "8文字以上"}
              className="mt-1"
              autoComplete="new-password"
            />
            {initial && (
              <p className="text-xs text-slate-400 mt-1">
                パスワードを忘れた方には、ここで新しいパスワードを設定して伝えてください。
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>キャンセル</Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UserMaster() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useUsers();
  const { data: auth } = useAuthStatus();
  const { mark, isNew } = useHighlightNew();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "削除に失敗しました");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      toast({ title: "削除しました" });
    },
    onError: (err) => {
      toast({
        title: "エラー",
        description: err instanceof Error ? err.message : "削除に失敗しました",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (u: AppUser) => {
    if (!window.confirm(`「${u.name}（${u.email}）」を削除してもよいですか？\n削除するとこのユーザーはログインできなくなります。`)) return;
    remove.mutate(u.id);
  };

  const items = data?.items ?? [];
  const isSelf = (u: AppUser) => auth?.user?.id === u.id;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <UserCog className="w-6 h-6 text-primary" />
            ユーザー管理
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            ログインできるユーザーの追加・変更・削除を行います。パスワードの再設定もここからできます。
          </p>
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
                <TableHead>名前</TableHead>
                <TableHead>メールアドレス（ログインID）</TableHead>
                <TableHead className="w-28">登録日</TableHead>
                <TableHead className="w-24 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />読み込み中...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-slate-400">
                    ユーザーが登録されていません
                  </TableCell>
                </TableRow>
              ) : (
                items.map((u) => (
                  <TableRow key={u.id} data-row-id={u.id} className={cn(isNew(u.id) && "highlight-new")}>
                    <TableCell className="font-medium">
                      {u.name}
                      {isSelf(u) && <Badge variant="secondary" className="ml-2">自分</Badge>}
                    </TableCell>
                    <TableCell className="text-slate-600">{u.email}</TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString("ja-JP") : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => { setEditing(u); setDialogOpen(true); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {!isSelf(u) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(u)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <UserFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        onSaved={mark}
      />
    </div>
  );
}
