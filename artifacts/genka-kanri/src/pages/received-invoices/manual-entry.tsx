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
import { useVendors } from "@/hooks/use-vendors";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── 手入力の逃げ道 ──────────────────────────────────────────────────────────
//
// AIが読めない様式・手書きの請求書、AI未設定の環境でも業務が止まらないように、
// 事務が仮デジタル請求書を手で起こせるようにする。作ったあとの流れ（送信→現場が
// 工事を選ぶ→確定）はAI読み取りの場合とまったく同じ。

interface Row {
  slipNo: string;
  deliveryDate: string;
  deliveryTo: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  isNonPurchase: boolean;
}

const emptyRow = (): Row => ({
  slipNo: "", deliveryDate: "", deliveryTo: "", description: "",
  quantity: "1", unit: "式", unitPrice: "", amount: "", isNonPurchase: false,
});

const n = (s: string) => parseFloat(s) || 0;

export function ManualEntry({
  onCreated,
  onCancel,
}: {
  onCreated: (id: number, summary: { vendorName: string; total: number; lines: number; blocks: number }) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { data: vendors = [] } = useVendors<{ id: number; name: string }>();

  const [vendorId, setVendorId] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);

  const set = (i: number, patch: Partial<Row>) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // 数量×単価が入っていれば金額を自動計算（金額を直接打った場合はそちらを優先）
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

  const subtotal = rows.filter((r) => !r.isNonPurchase).reduce((s, r) => s + n(r.amount), 0);
  const adjust = rows.filter((r) => r.isNonPurchase).reduce((s, r) => s + n(r.amount), 0);
  const tax = Math.floor(subtotal * 0.1);
  const total = subtotal + tax + adjust;

  const vendorName = vendors.find((v) => String(v.id) === vendorId)?.name ?? "";
  const canSave = vendorId !== "" && rows.some((r) => r.description.trim() !== "");

  const save = async () => {
    setSaving(true);
    try {
      const items = rows
        .filter((r) => r.description.trim() !== "")
        .map((r, idx) => ({
          lineNumber: idx + 1,
          slipNo: r.slipNo || null,
          deliveryDate: r.deliveryDate || null,
          deliveryTo: r.deliveryTo || null,
          category: "material",
          description: r.description,
          quantity: n(r.quantity) || 1,
          unit: r.unit || "式",
          unitPrice: n(r.unitPrice),
          amount: n(r.amount),
          taxRate: 10,
          isNonPurchase: r.isNonPurchase,
        }));

      const res = await fetch(`${BASE}/api/received-invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: Number(vendorId),
          vendorName,
          invoiceDate: invoiceDate || null,
          paymentDueDate: paymentDueDate || null,
          subtotal, taxAmount: tax, totalAmount: total,
          aiExtracted: false,
          amountMismatch: false,
          items,
        }),
      });
      if (!res.ok) throw new Error("作成に失敗しました");
      const { id } = await res.json();

      const slips = new Set(items.filter((i) => i.slipNo).map((i) => i.slipNo));
      onCreated(id, {
        vendorName,
        total,
        lines: items.length,
        blocks: slips.size > 0 ? slips.size : items.length,
      });
      toast({ title: "作成しました", description: "送り先を選んで送信してください。" });
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
            <Label className="text-xs">仕入先 <span className="text-red-500">*</span></Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="選択してください" /></SelectTrigger>
              <SelectContent className="max-h-[300px]" searchPlaceholder="仕入先を検索">
                {vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">請求日</Label>
            <DateInput value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">支払期日</Label>
            <DateInput value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500">
                <th className="text-left px-2 py-2 w-24">伝票番号</th>
                <th className="text-left px-2 py-2 w-32">納品先</th>
                <th className="text-left px-2 py-2">品名 <span className="text-red-500">*</span></th>
                <th className="text-right px-2 py-2 w-20">数量</th>
                <th className="text-left px-2 py-2 w-16">単位</th>
                <th className="text-right px-2 py-2 w-28">単価</th>
                <th className="text-right px-2 py-2 w-28">金額</th>
                <th className="text-center px-2 py-2 w-20">仕入以外</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-b ${r.isNonPurchase ? "bg-slate-50/70" : ""}`}>
                  <td className="px-2 py-1.5">
                    <Input className="h-8 text-sm" value={r.slipNo} onChange={(e) => set(i, { slipNo: e.target.value })} placeholder="4521" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="h-8 text-sm" value={r.deliveryTo} onChange={(e) => set(i, { deliveryTo: e.target.value })} placeholder="山田様邸" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="h-8 text-sm" value={r.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="構造用合板 12mm" />
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
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setRows((p) => [...p, emptyRow()])}>
            <Plus className="w-3.5 h-3.5" /> 行を追加
          </Button>
          <div className="text-sm text-slate-600 space-x-4 tabular-nums">
            <span>税抜 {formatCurrency(subtotal)}</span>
            <span>消費税 {formatCurrency(tax)}</span>
            {adjust !== 0 && <span className="text-slate-500">調整 {formatCurrency(adjust)}</span>}
            <span className="font-bold text-slate-900">合計 {formatCurrency(total)}</span>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          ※ 同じ伝票番号の行は1ブロックにまとまり、現場担当者はブロック単位で工事を選びます。
          入金・値引などの行は「仕入以外」にチェックすると原価に計上されません。
        </p>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={!canSave || saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            この内容で作成
          </Button>
          <button type="button" className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2" onClick={onCancel}>
            やめる
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
