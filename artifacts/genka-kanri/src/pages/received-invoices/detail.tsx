import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, FileText, AlertTriangle, CheckCircle2, Send, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useVendors } from "@/hooks/use-vendors";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Line {
  id: number;
  slipNo: string | null;
  deliveryDate: string | null;
  deliveryTo: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  projectId: number | null;
  isNonPurchase: boolean;
}
interface Block {
  key: string;
  slipNo: string | null;
  deliveryDate: string | null;
  deliveryTo: string | null;
  amount: number;
  lineCount: number;
  lines: Line[];
  itemIds: number[];
  projectId: number | null;
  hasNonPurchase: boolean;
  allPurchaseAssigned: boolean;
}
interface Detail {
  id: number;
  vendorId: number | null;
  vendorName: string;
  invoiceDate: string | null;
  paymentDueDate: string | null;
  status: string;
  aiExtracted: boolean;
  amountMismatch: boolean;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  hasFile: boolean;
  blocks: Block[];
  unassignedAmount: number;
  unassignedCount: number;
  recipients: { staffMemberId: number; name: string; respondedAt: string | null }[];
}
interface Project { id: number; name: string; projectCode: string }

const NONE = "__none__";

export default function ReceivedInvoiceDetail({ id }: { id: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // 明細は既定で見せる。ブロックの見出し（納品書No・納品先）に判断材料が無い請求書
  // （いわさき工房のように納品先の印字が無いもの）では、品名が唯一の手掛かりになるため。
  // 行数が多いブロックだけ畳む（大田鋼管のような多明細でスクロールが辛くならないように）。
  const COLLAPSE_OVER = 6;

  const { data: vendors = [] } = useVendors<{ id: number; name: string }>();

  const { data: projectsData } = useQuery({
    queryKey: ["/api/projects"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/projects`);
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<{ items: Project[] }>;
    },
  });
  const projects = projectsData?.items ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ["/api/received-invoices", id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}`);
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<Detail>;
    },
  });

  // 割当（ブロック単位でまとめて更新）
  const assignMut = useMutation({
    mutationFn: async (a: { itemIds: number[]; projectId: number | null }) => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: a.itemIds.map((itemId) => ({ itemId, projectId: a.projectId })) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "保存に失敗しました");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] }),
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const respondMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "送信に失敗しました");
    },
    onSuccess: () => {
      toast({ title: "送信しました", description: "事務の確認待ちになりました。" });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
    },
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const vendorMut = useMutation({
    mutationFn: async (vendorId: number) => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}/vendor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });
      if (!r.ok) throw new Error("仕入先の保存に失敗しました");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] }),
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "削除に失敗しました");
    },
    onSuccess: () => {
      toast({ title: "削除しました" });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
      navigate("/received-invoices");
    },
    onError: (e) => toast({ title: "削除できません", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const confirmMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? "確定に失敗しました");
      return j as { created: { projectId: number; voucherNumber: string; totalAmount: number }[] };
    },
    onSuccess: (j) => {
      toast({
        title: "確定しました",
        description: `仕入伝票を${j.created.length}件つくりました（${j.created.map((c) => c.voucherNumber).join(", ")}）`,
      });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/cost-items"] });
    },
    onError: (e) => toast({ title: "確定できません", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const purchaseBlocks = useMemo(() => (data?.blocks ?? []).filter((b) => b.itemIds.length > 0), [data]);
  const assignedCount = purchaseBlocks.filter((b) => b.allPurchaseAssigned).length;
  // 0円の明細が未割当でも金額は0のままなので、完了判定は件数で行う
  const done = (data?.unassignedCount ?? 1) === 0;
  const locked = data?.status === "confirmed" || data?.status === "cancelled";

  if (isLoading) {
    return <div className="p-6 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  }
  if (!data) {
    return <div className="p-6 text-center text-slate-400">見つかりませんでした</div>;
  }

  // 分母は仕入行の合計（税抜）。請求総額は税込なので、これを分母にすると
  // 0割当でもバーが伸びてしまう。
  const purchaseTotal = purchaseBlocks.reduce((s, b) => s + b.amount, 0);
  const progress = purchaseTotal > 0
    ? Math.max(0, Math.min(100, ((purchaseTotal - data.unassignedAmount) / purchaseTotal) * 100))
    : 0;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/received-invoices">
          <button className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 一覧へ戻る
          </button>
        </Link>
        {data.status !== "confirmed" && (
          <button
            className="text-sm text-slate-400 hover:text-red-500 flex items-center gap-1"
            onClick={() => {
              if (confirm(`${data.vendorName || "この請求書"}を削除しますか？\n原本の画像も一緒に消えます。`)) {
                delMut.mutate();
              }
            }}
          >
            <Trash2 className="w-3.5 h-3.5" /> 削除
          </button>
        )}
      </div>

      {/* ヘッダ */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {data.status === "sent" && <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 mb-1">仮 ─ 未回答</Badge>}
              {data.status === "answered" && <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 mb-1">確認待ち</Badge>}
              {data.status === "confirmed" && <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 mb-1">確定済</Badge>}
              {data.status === "draft" && <Badge variant="outline" className="mb-1">下書き</Badge>}
              <h1 className="text-lg font-bold text-slate-900 leading-snug">{data.vendorName || "（仕入先不明）"}</h1>
            </div>
            {data.hasFile && (
              <a href={`${BASE}/api/received-invoices/${id}/file`} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                  <FileText className="w-4 h-4" /> 原本
                </Button>
              </a>
            )}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">請求日</dt><dd className="tabular-nums">{data.invoiceDate ?? "—"}</dd>
            <dt className="text-slate-500">支払期日</dt><dd className="tabular-nums">{data.paymentDueDate ?? "—"}</dd>
            <dt className="text-slate-500">請求額</dt><dd className="tabular-nums font-medium">{formatCurrency(data.totalAmount)}</dd>
            <dt className="text-slate-500">明細</dt><dd>{data.blocks.reduce((s, b) => s + b.lineCount, 0)}行 ─ {purchaseBlocks.length}ブロック</dd>
          </dl>

          {data.amountMismatch && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>明細の合計と請求総額が一致していません。原本を確認してください。</span>
            </div>
          )}

          {/* 残額バー */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">未割当</span>
              <span className={`text-lg font-bold tabular-nums ${done ? "text-emerald-600" : "text-amber-600"}`}>
                {formatCurrency(data.unassignedAmount)}
              </span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-slate-500 tabular-nums">
              {purchaseBlocks.length}ブロック中 {assignedCount}ブロック割当済
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ブロック一覧 */}
      <div className="space-y-3">
        {data.blocks.map((b) => {
          const isNon = b.itemIds.length === 0;
          const assigned = b.allPurchaseAssigned;
          const isOpen = open[b.key] ?? b.lineCount <= COLLAPSE_OVER;
          return (
            <Card key={b.key} className={`border-l-4 ${isNon ? "border-l-slate-300 bg-slate-50/60" : assigned ? "border-l-emerald-500 bg-emerald-50/40" : "border-l-amber-500"}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-bold text-slate-800">
                      {b.slipNo ? `納品書 No.${b.slipNo}` : isNon ? "（仕入以外）" : "明細"}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {b.deliveryDate ? `${b.deliveryDate} 納品 ・ ` : ""}{b.lineCount}行
                      {b.deliveryTo ? <> ・ 納品先 <span className="font-semibold text-slate-700">{b.deliveryTo}</span></> : b.slipNo ? <> ・ <span className="text-amber-600">納品先の記載なし</span></> : null}
                    </div>
                    {/* 品名の要約。畳んでいても何のブロックか分かるようにする */}
                    {!isNon && (
                      <div className="text-xs text-slate-600 mt-1 truncate">
                        {b.lines[0]?.description}
                        {b.lineCount > 1 && <span className="text-slate-400"> 他{b.lineCount - 1}件</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-sm font-bold tabular-nums whitespace-nowrap">{formatCurrency(b.amount)}</div>
                </div>

                {isNon ? (
                  <div className="text-xs text-slate-500 bg-white/60 rounded px-2 py-1.5 border">
                    入金・値引などのため、原価には計上しません。
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">工事</label>
                    <Select
                      value={b.projectId ? String(b.projectId) : NONE}
                      disabled={locked || assignMut.isPending}
                      onValueChange={(v) => assignMut.mutate({ itemIds: b.itemIds, projectId: v === NONE ? null : Number(v) })}
                    >
                      <SelectTrigger className={`h-11 ${!assigned ? "border-amber-400 text-amber-700" : ""}`}>
                        <SelectValue placeholder="選択してください" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]" searchPlaceholder="工事名で検索">
                        <SelectItem value={NONE} className="text-slate-400">（未選択）</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            <span className="font-mono text-xs text-slate-400 mr-1.5">{p.projectCode}</span>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {b.lineCount > COLLAPSE_OVER && (
                  <button
                    type="button"
                    onClick={() => setOpen((p) => ({ ...p, [b.key]: !isOpen }))}
                    className="text-xs text-primary hover:underline underline-offset-2 flex items-center gap-1"
                  >
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    明細 {b.lineCount}行を{isOpen ? "閉じる" : "開く"}
                  </button>
                )}

                {isOpen && (
                  <table className="w-full text-xs border-t">
                    <tbody>
                      {b.lines.map((l) => (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="py-1.5 pr-2">{l.description}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-slate-500 whitespace-nowrap">{l.quantity} {l.unit}</td>
                          <td className="py-1.5 pl-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 下部アクション */}
      {!locked && (
        <Card className="sticky bottom-4 shadow-lg">
          <CardContent className="p-4 space-y-3">
            {!done ? (
              <div className="text-sm font-medium text-amber-600">
                未割当が{purchaseBlocks.length - assignedCount}ブロック残っています
              </div>
            ) : (
              <div className="text-sm font-medium text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> すべて割り当てました
              </div>
            )}

            {data.status === "sent" && (
              <Button className="w-full h-11" disabled={!done || respondMut.isPending} onClick={() => respondMut.mutate()}>
                {respondMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                選択した内容を送信
              </Button>
            )}

            {(data.status === "answered" || data.status === "draft") && (
              <div className="space-y-2">
                {!data.vendorId && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-amber-700">仕入先が未確定です（確定に必要）</label>
                    <Select onValueChange={(v) => vendorMut.mutate(Number(v))}>
                      <SelectTrigger className="h-10 border-amber-400"><SelectValue placeholder="仕入先を選ぶ" /></SelectTrigger>
                      <SelectContent className="max-h-[300px]" searchPlaceholder="仕入先を検索">
                        {vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-700"
                  disabled={!done || !data.vendorId || confirmMut.isPending}
                  onClick={() => confirmMut.mutate()}
                >
                  {confirmMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  確定して仕入伝票をつくる
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.status === "confirmed" && (
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="text-sm text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              確定済みです。工事ごとの仕入伝票が作られ、原価に計上されました。
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/purchases")}>仕入を見る</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
