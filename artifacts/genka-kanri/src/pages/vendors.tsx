import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Pencil, Trash2, Loader2, Save, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHighlightNew } from "@/hooks/use-highlight-new";
import { toHankakuKana, cn } from "@/lib/utils";

interface VendorGroup {
  id: number;
  name: string;
}

interface Vendor {
  id: number;
  name: string;
  code: string | null;
  groupId: number | null;
  groupName: string | null;
  closingDay: number;
  paymentMonths: number;
  paymentDay: number;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  bankCode: string | null;
  bankName: string | null;
  bankNameKana: string | null;
  bankBranchCode: string | null;
  bankBranch: string | null;
  bankBranchKana: string | null;
  bankAccountType: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  bankAccountHolderKana: string | null;
  invoiceRegistrationNumber: string | null;
}

const CLOSING_DAY_OPTIONS = [
  { value: 5, label: "5日" },
  { value: 10, label: "10日" },
  { value: 15, label: "15日" },
  { value: 20, label: "20日" },
  { value: 25, label: "25日" },
  { value: 99, label: "月末" },
];

const PAYMENT_MONTH_OPTIONS = [
  { value: 0, label: "当月" },
  { value: 1, label: "翌月" },
  { value: 2, label: "翌々月" },
];

const PAYMENT_DAY_OPTIONS = [
  { value: 5, label: "5日" },
  { value: 10, label: "10日" },
  { value: 15, label: "15日" },
  { value: 20, label: "20日" },
  { value: 25, label: "25日" },
  { value: 99, label: "月末" },
];

const BANK_ACCOUNT_TYPE_OPTIONS = [
  { value: "普通", label: "普通" },
  { value: "当座", label: "当座" },
  { value: "貯蓄", label: "貯蓄" },
  { value: "その他", label: "その他" },
];

function useVendorGroups() {
  return useQuery({
    queryKey: ["/api/vendor-groups"],
    queryFn: async () => {
      const res = await fetch("/api/vendor-groups");
      if (!res.ok) throw new Error("Failed to fetch vendor groups");
      return res.json() as Promise<{ items: VendorGroup[] }>;
    },
  });
}

function useVendors() {
  return useQuery({
    queryKey: ["/api/vendors"],
    queryFn: async () => {
      const res = await fetch("/api/vendors");
      if (!res.ok) throw new Error("Failed to fetch vendors");
      return res.json() as Promise<{ items: Vendor[]; total: number }>;
    },
  });
}

function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Vendor>) => {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vendors"] }),
  });
}

function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Vendor> & { id: number }) => {
      const res = await fetch(`/api/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vendors"] }),
  });
}

function useDeleteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/vendors/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vendors"] }),
  });
}

interface VendorFormState {
  name: string;
  code: string;
  groupId: string;
  closingDay: number;
  paymentMonths: number;
  paymentDay: number;
  contactName: string;
  phone: string;
  email: string;
  notes: string;
  bankCode: string;
  bankName: string;
  bankNameKana: string;
  bankBranchCode: string;
  bankBranch: string;
  bankBranchKana: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  bankAccountHolderKana: string;
  invoiceRegistrationNumber: string;
}

function defaultForm(v?: Vendor | null): VendorFormState {
  return {
    name: v?.name ?? "",
    code: v?.code ?? "",
    groupId: v?.groupId ? String(v.groupId) : "none",
    closingDay: v?.closingDay ?? 99,
    paymentMonths: v?.paymentMonths ?? 1,
    paymentDay: v?.paymentDay ?? 25,
    contactName: v?.contactName ?? "",
    phone: v?.phone ?? "",
    email: v?.email ?? "",
    notes: v?.notes ?? "",
    invoiceRegistrationNumber: v?.invoiceRegistrationNumber ?? "",
    bankCode: v?.bankCode ?? "",
    bankName: v?.bankName ?? "",
    bankNameKana: v?.bankNameKana ?? "",
    bankBranchCode: v?.bankBranchCode ?? "",
    bankBranch: v?.bankBranch ?? "",
    bankBranchKana: v?.bankBranchKana ?? "",
    bankAccountType: v?.bankAccountType ?? "普通",
    bankAccountNumber: v?.bankAccountNumber ?? "",
    bankAccountHolder: v?.bankAccountHolder ?? "",
    bankAccountHolderKana: v?.bankAccountHolderKana ?? "",
  };
}

interface VendorFormDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: Vendor | null;
  groups: VendorGroup[];
  onSaved?: (id: number) => void;
}

function VendorFormDialog({ open, onClose, initial, groups, onSaved }: VendorFormDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<VendorFormState>(() => defaultForm(initial));
  const [bankOpen, setBankOpen] = useState(false);
  const create = useCreateVendor();
  const update = useUpdateVendor();
  const isPending = create.isPending || update.isPending;

  useEffect(() => {
    if (open) {
      setForm(defaultForm(initial));
      setBankOpen(false);
    }
  }, [open, initial]);

  const set = (field: keyof VendorFormState, value: string | number) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleClose = () => {
    onClose();
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "入力エラー", description: "仕入先名は必須です", variant: "destructive" });
      return;
    }
    const invoiceNum = form.invoiceRegistrationNumber.trim();
    if (invoiceNum && !/^T\d{13}$/.test(invoiceNum)) {
      toast({ title: "入力エラー", description: "インボイス登録番号は「T」＋13桁の数字で入力してください（例: T1234567890123）", variant: "destructive" });
      return;
    }
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      groupId: form.groupId !== "none" && form.groupId ? Number(form.groupId) : null,
      closingDay: form.closingDay,
      paymentMonths: form.paymentMonths,
      paymentDay: form.paymentDay,
      contactName: form.contactName.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
      invoiceRegistrationNumber: invoiceNum,
      bankCode: form.bankCode.trim(),
      bankName: form.bankName.trim(),
      bankNameKana: form.bankNameKana.trim(),
      bankBranchCode: form.bankBranchCode.trim(),
      bankBranch: form.bankBranch.trim(),
      bankBranchKana: form.bankBranchKana.trim(),
      bankAccountType: form.bankAccountType,
      bankAccountNumber: form.bankAccountNumber.trim(),
      bankAccountHolder: form.bankAccountHolder.trim(),
      bankAccountHolderKana: form.bankAccountHolderKana.trim(),
    };
    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, ...payload });
        toast({ title: "更新しました" });
        onSaved?.(initial.id);
      } else {
        const created = await create.mutateAsync(payload);
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "仕入先編集" : "仕入先新規登録"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>仕入先名 <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="例: 山田建材株式会社" className="mt-1" />
            </div>
            <div>
              <Label>仕入先コード</Label>
              <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="例: V001" className="mt-1" />
            </div>
            <div>
              <Label>グループ</Label>
              <Select value={form.groupId} onValueChange={(v) => set("groupId", v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="グループを選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">（なし）</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-slate-500 mb-2">インボイス制度</p>
            <div>
              <Label className="text-xs">適格請求書発行事業者登録番号</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={form.invoiceRegistrationNumber}
                  onChange={(e) => set("invoiceRegistrationNumber", e.target.value)}
                  placeholder="例: T1234567890123"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">「T」＋13桁の数字。未登録の場合は空欄のままにしてください。</p>
            </div>
          </div>

          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-slate-500 mb-2">支払条件</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">締日</Label>
                <Select value={String(form.closingDay)} onValueChange={(v) => set("closingDay", Number(v))}>
                  <SelectTrigger className="mt-1 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLOSING_DAY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">支払月</Label>
                <Select value={String(form.paymentMonths)} onValueChange={(v) => set("paymentMonths", Number(v))}>
                  <SelectTrigger className="mt-1 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MONTH_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">支払日</Label>
                <Select value={String(form.paymentDay)} onValueChange={(v) => set("paymentDay", Number(v))}>
                  <SelectTrigger className="mt-1 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_DAY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-slate-500 mb-2">連絡先</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">担当者名</Label>
                <Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="例: 田中 太郎" className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">電話番号</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="例: 03-1234-5678" className="mt-1 h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">メール</Label>
                <Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="例: info@example.com" className="mt-1 h-8 text-sm" />
              </div>
            </div>
          </div>

          <div>
            <Label>備考</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="mt-1 resize-none" rows={2} />
          </div>

          {/* 振込先口座情報（アコーディオン） */}
          <div className="border rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
              onClick={() => setBankOpen((prev) => !prev)}
            >
              <span className="text-sm font-semibold text-slate-700">振込先口座情報</span>
              <span className="flex items-center gap-1 text-xs text-slate-500">
                {bankOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
            </button>
            {bankOpen && (
              <div className="px-4 pb-4 pt-3 space-y-3">
                <p className="text-xs text-slate-400">全銀フォーマットCSV出力に使用します。カナ項目は半角カナで入力してください。</p>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">銀行コード</Label>
                    <Input value={form.bankCode} onChange={(e) => set("bankCode", e.target.value)} placeholder="4桁" className="mt-1 h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">銀行名</Label>
                    <Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="〇〇銀行" className="mt-1 h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">銀行名カナ</Label>
                    <Input value={form.bankNameKana} onChange={(e) => set("bankNameKana", toHankakuKana(e.target.value))} placeholder="半角カナ15桁以内" className="mt-1 h-8 text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">支店コード</Label>
                    <Input value={form.bankBranchCode} onChange={(e) => set("bankBranchCode", e.target.value)} placeholder="3桁" className="mt-1 h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">支店名</Label>
                    <Input value={form.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} placeholder="〇〇支店" className="mt-1 h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">支店名カナ</Label>
                    <Input value={form.bankBranchKana} onChange={(e) => set("bankBranchKana", toHankakuKana(e.target.value))} placeholder="半角カナ15桁以内" className="mt-1 h-8 text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">預金種目</Label>
                    <Select value={form.bankAccountType} onValueChange={(v) => set("bankAccountType", v)}>
                      <SelectTrigger className="mt-1 h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BANK_ACCOUNT_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">口座番号</Label>
                    <Input value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} placeholder="7桁以内" className="mt-1 h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">受取人名</Label>
                    <Input value={form.bankAccountHolder} onChange={(e) => set("bankAccountHolder", e.target.value)} placeholder="漢字可" className="mt-1 h-8 text-sm" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">受取人名カナ</Label>
                  <Input value={form.bankAccountHolderKana} onChange={(e) => set("bankAccountHolderKana", toHankakuKana(e.target.value))} placeholder="半角カナ30桁以内" className="mt-1 h-8 text-sm" />
                </div>
              </div>
            )}
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

function closingDayLabel(day: number) {
  if (day === 99) return "月末";
  return `${day}日`;
}

function paymentMonthsLabel(months: number) {
  if (months === 0) return "当月";
  if (months === 1) return "翌月";
  return "翌々月";
}

function paymentDayLabel(day: number) {
  if (day === 99) return "月末";
  return `${day}日`;
}

export default function Vendors() {
  const { toast } = useToast();
  const { data, isLoading } = useVendors();
  const { data: groupsData } = useVendorGroups();
  const deleteVendor = useDeleteVendor();
  const { mark, isNew } = useHighlightNew();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);

  const items = data?.items ?? [];
  const groups = groupsData?.items ?? [];

  const handleDelete = async (v: Vendor) => {
    if (!window.confirm(`「${v.name}」を削除してもよいですか？`)) return;
    try {
      await deleteVendor.mutateAsync(v.id);
      toast({ title: "削除しました" });
    } catch {
      toast({ title: "エラー", description: "削除に失敗しました", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            仕入先マスタ
          </h1>
          <p className="text-sm text-slate-500 mt-1">仕入先の基本情報・支払条件を管理します。</p>
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
                <TableHead>仕入先名</TableHead>
                <TableHead>コード</TableHead>
                <TableHead>グループ</TableHead>
                <TableHead>適格番号</TableHead>
                <TableHead>締日</TableHead>
                <TableHead>支払サイト</TableHead>
                <TableHead className="w-24 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />読み込み中...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-400">
                    仕入先が登録されていません
                  </TableCell>
                </TableRow>
              ) : (
                items.map((v) => (
                  <TableRow key={v.id} data-row-id={v.id} className={cn(isNew(v.id) && "highlight-new")}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-400">{v.code ?? "—"}</TableCell>
                    <TableCell>
                      {v.groupName ? (
                        <Badge variant="secondary" className="text-xs">{v.groupName}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {v.invoiceRegistrationNumber ? (
                        <span className="font-mono text-xs text-slate-700">{v.invoiceRegistrationNumber}</span>
                      ) : (
                        <span className="text-xs text-slate-400">未登録</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{closingDayLabel(v.closingDay)}締め</TableCell>
                    <TableCell className="text-sm">
                      {paymentMonthsLabel(v.paymentMonths)}{paymentDayLabel(v.paymentDay)}払い
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => { setEditing(v); setDialogOpen(true); }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(v)}
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

      <VendorFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        groups={groups}
        onSaved={mark}
      />
    </div>
  );
}
