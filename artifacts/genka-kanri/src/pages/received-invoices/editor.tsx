import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWorkTypes } from "@/hooks/use-work-types";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── 事務が中身を整える画面（下書きのみ）─────────────────────────────────────
//
// AIの読み違い（日付・金額・品名）と、AIでは決められない科目・工種をここで直す。
// 現場に送る前に必ず通る場所なので、原価の入口の品質はここで決まる。
// 工種を空のまま確定すると、その原価は工種別の予算残から漏れる。

const CATEGORY_OPTIONS = [
  { value: "material", label: "材料費" },
  { value: "subcontract", label: "外注費" },
  { value: "labor", label: "労務費" },
  { value: "expense", label: "経費" },
];

const NO_WORK_TYPE = "__none__";

export interface EditorLine {
  id?: number;
  slipNo: string | null;
  deliveryDate: string | null;
  deliveryTo: string | null;
  category: string;
  workTypeId: number | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  taxRate: number;
  isNonPurchase: boolean;
}

interface Row {
  id?: number;
  slipNo: string;
  deliveryDate: string;
  deliveryTo: string;
  category: string;
  workTypeId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  taxRate: number;
  isNonPurchase: boolean;
}

const n = (s: string) => parseFloat(s) || 0;

const toRow = (l: EditorLine): Row => ({
  id: l.id,
  slipNo: l.slipNo ?? "",
  deliveryDate: l.deliveryDate ?? "",
  deliveryTo: l.deliveryTo ?? "",
  category: l.category || "material",
  workTypeId: l.workTypeId ? String(l.workTypeId) : NO_WORK_TYPE,
  description: l.description,
  quantity: String(l.quantity ?? 1),
  unit: l.unit ?? "",
  unitPrice: String(l.unitPrice ?? 0),
  amount: String(l.amount ?? 0),
  taxRate: l.taxRate ?? 10,
  isNonPurchase: l.isNonPurchase,
});

export function InvoiceEditor({
  invoiceId,
  invoiceDate: initialInvoiceDate,
  paymentDueDate: initialPaymentDueDate,
  totalAmount: initialTotalAmount,
  aiExtracted,
  lines,
  onSaved,
  onCancel,
}: {
  invoiceId: number;
  invoiceDate: string | null;
  paymentDueDate: string | null;
  totalAmount: number;
  aiExtracted: boolean;
  lines: EditorLine[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { data: workTypes = [] } = useWorkTypes<{ id: number; code: string; name: string }>();

  const [invoiceDate, setInvoiceDate] = useState(initialInvoiceDate ?? "");
  const [paymentDueDate, setPaymentDueDate] = useState(initialPaymentDueDate ?? "");
  const [totalAmount, setTotalAmount] = useState(String(initialTotalAmount ?? 0));
  const [rows, setRows] = useState<Row[]>(lines.map(toRow));
  const [saving, setSaving] = useState(false);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // 数量×単価が入っていれば金額を計算する（金額を直接打った場合はそちらを優先）
  const setQtyOrPrice = (i: number, patch: Partial<Row>) => {
    setRows((p) =>
      p.map((r, idx) => {
        if (idx !== i) return r;
        const next = { ...r, ...patch };
        const q = n(next.quantity), u = n(next.unitPrice);
        if (q && u) next.amount = String(Math.round(q * u));
        return next;
      }),
    );
  };

  const purchaseRows = rows.filter((r) => !r.isNonPurchase);
  const subtotal = purchaseRows.reduce((s, r) => s + n(r.amount), 0);
  const tax = Math.floor(purchaseRows.reduce((s, r) => s + n(r.amount) * (r.taxRate / 100), 0));
  const adjust = rows.filter((r) => r.isNonPurchase).reduce((s, r) => s + n(r.amount), 0);
  const computed = subtotal + tax + adjust;
  const diff = computed - n(totalAmount);
  const mismatch = Math.abs(diff) > Math.max(Math.round(Math.abs(computed) * 0.005), 100);
  const missingWorkType = purchaseRows.filter((r) => r.workTypeId === NO_WORK_TYPE).length;

  const save = async () => {
    setSaving(true);
    try {
      const items = rows
        .filter((r) => r.description.trim() !== "")
        .map((r) => ({
          id: r.id,
          slipNo: r.slipNo || null,
          deliveryDate: r.deliveryDate || null,
          deliveryTo: r.deliveryTo || null,
          category: r.category,
          workTypeId: r.workTypeId === NO_WORK_TYPE ? null : Number(r.workTypeId),
          description: r.description,
          quantity: n(r.quantity) || 1,
          unit: r.unit || "式",
          unitPrice: n(r.unitPrice),
          amount: n(r.amount),
          taxRate: r.taxRate,
          isNonPurchase: r.isNonPurchase,
        }));

      const res = await fetch(`${BASE}/api/received-invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceDate: invoiceDate || null,
          paymentDueDate: paymentDueDate || null,
          totalAmount: n(totalAmount),
          items,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "保存に失敗しました");
      toast({ title: "保存しました" });
      onSaved();
    } catch (e) {
      toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-slate-300">
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">請求日</Label>
            <DateInput value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">支払期日</Label>
            <DateInput value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            {/* ラベルで「原本の今回ご請求額」と断言しない。AIが読み違えると
                原本に無い数字が入り、「この金額は何？」と探させることになる。 */}
            <Label className="text-xs">請求額</Label>
            <NumberInput
              className={`text-right ${mismatch ? "border-amber-400" : ""}`}
              value={totalAmount}
              onChange={setTotalAmount}
            />
            <p className="text-xs text-slate-500">
              {aiExtracted
                ? "AIが読み取った金額です。原本の「今回ご請求額」と違っていたら直してください。"
                : "原本の「今回ご請求額」を入れてください。"}
            </p>
            {/* 明細から自動計算はしない。自動にすると、AIが金額を読み違えても
                必ず一致してしまい検算の警告が二度と出なくなる。代わりに1押しで
                入れられるようにする（明細を直しても請求額が変わらず戸惑うため）。 */}
            {mismatch && (
              <button
                type="button"
                onClick={() => setTotalAmount(String(computed))}
                className="text-xs text-primary hover:underline underline-offset-2"
              >
                明細の合計 {formatCurrency(computed)} を入れる
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1180px]">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500">
                <th className="text-left px-2 py-2 w-24">伝票番号</th>
                <th className="text-left px-2 py-2 w-28">納品先</th>
                <th className="text-left px-2 py-2">仕様</th>
                <th className="text-left px-2 py-2 w-24">科目</th>
                <th className="text-left px-2 py-2 w-36">工種</th>
                <th className="text-right px-2 py-2 w-16">数量</th>
                <th className="text-left px-2 py-2 w-14">単位</th>
                <th className="text-right px-2 py-2 w-24">単価</th>
                <th className="text-right px-2 py-2 w-24">金額</th>
                <th className="text-center px-2 py-2 w-16">仕入以外</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? `new-${i}`} className={`border-b ${r.isNonPurchase ? "bg-slate-50/70" : ""}`}>
                  <td className="px-2 py-1.5">
                    <Input className="h-8 text-sm" value={r.slipNo} onChange={(e) => set(i, { slipNo: e.target.value })} placeholder="4521" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="h-8 text-sm" value={r.deliveryTo} onChange={(e) => set(i, { deliveryTo: e.target.value })} placeholder="山田様邸" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="h-8 text-sm" value={r.description} onChange={(e) => set(i, { description: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Select value={r.category} onValueChange={(v) => set(i, { category: v })} disabled={r.isNonPurchase}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Select value={r.workTypeId} onValueChange={(v) => set(i, { workTypeId: v })} disabled={r.isNonPurchase}>
                      <SelectTrigger className={`h-8 text-sm ${!r.isNonPurchase && r.workTypeId === NO_WORK_TYPE ? "border-amber-400 text-amber-700" : ""}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]" searchPlaceholder="工種を検索">
                        <SelectItem value={NO_WORK_TYPE} className="text-slate-400">（未設定）</SelectItem>
                        {workTypes.map((w) => (
                          <SelectItem key={w.id} value={String(w.id)}>
                            <span className="font-mono text-xs text-slate-400 mr-1.5">{w.code}</span>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <NumberInput className="h-8 text-sm text-right" value={r.quantity} onChange={(v) => setQtyOrPrice(i, { quantity: v })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="h-8 text-sm" value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <NumberInput className="h-8 text-sm text-right" value={r.unitPrice} onChange={(v) => setQtyOrPrice(i, { unitPrice: v })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <NumberInput className="h-8 text-sm text-right" value={r.amount} onChange={(v) => set(i, { amount: v })} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Checkbox checked={r.isNonPurchase} onCheckedChange={(v) => set(i, { isNonPurchase: !!v })} />
                  </td>
                  <td className="px-1">
                    {rows.length > 1 && (
                      <button type="button" onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}
                        className="text-slate-300 hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              setRows((p) => [
                ...p,
                {
                  slipNo: p[p.length - 1]?.slipNo ?? "", deliveryDate: "", deliveryTo: p[p.length - 1]?.deliveryTo ?? "",
                  category: "material", workTypeId: p[p.length - 1]?.workTypeId ?? NO_WORK_TYPE, description: "",
                  quantity: "1", unit: "式", unitPrice: "", amount: "", taxRate: 10, isNonPurchase: false,
                },
              ])
            }
          >
            <Plus className="w-3.5 h-3.5" /> 行を追加
          </Button>
          <div className="text-sm text-slate-600 space-x-4 tabular-nums">
            <span>税抜 {formatCurrency(subtotal)}</span>
            <span>消費税 {formatCurrency(tax)}</span>
            {adjust !== 0 && <span className="text-slate-500">調整 {formatCurrency(adjust)}</span>}
            <span className="font-bold text-slate-900">合計 {formatCurrency(computed)}</span>
          </div>
        </div>

        {mismatch && (
          <p className="text-xs text-amber-700">
            明細から計算した合計 {formatCurrency(computed)} が、請求額 {formatCurrency(n(totalAmount))} と
            {formatCurrency(Math.abs(diff))}ずれています。原本を見て、明細を直すか、上の請求額を直してください。
          </p>
        )}
        {missingWorkType > 0 && (
          <p className="text-xs text-amber-700">
            工種が未設定の行が{missingWorkType}行あります。このままだと、その原価は工種ごとの予算残に載りません。
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            この内容で保存
          </Button>
          <button type="button" className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2" onClick={onCancel}>
            やめる
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
