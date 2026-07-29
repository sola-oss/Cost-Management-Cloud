import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileScan, ChevronRight, AlertTriangle, PencilLine, Trash2 } from "lucide-react";
import { ManualEntry } from "./manual-entry";
import { useToast } from "@/hooks/use-toast";
import { useVendors } from "@/hooks/use-vendors";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── 型 ──────────────────────────────────────────────────────────────────────
interface RecipientRow { staffMemberId: number; name: string; respondedAt: string | null }
interface InvoiceRow {
  id: number;
  vendorName: string;
  invoiceDate: string | null;
  paymentDueDate: string | null;
  status: string;
  amountMismatch: boolean;
  totalAmount: number;
  unassignedAmount: number;
  unassignedCount: number;
  blockCount: number;
  assignedBlockCount: number;
  sentAt: string | null;
  createdAt: string;
  recipients: RecipientRow[];
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:     { label: "下書き",   cls: "bg-slate-100 text-slate-700 border-slate-200" },
  sent:      { label: "未回答",   cls: "bg-amber-100 text-amber-700 border-amber-200" },
  answered:  { label: "確認待ち", cls: "bg-blue-100 text-blue-700 border-blue-200" },
  confirmed: { label: "確定済",   cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  cancelled: { label: "取消",     cls: "bg-red-100 text-red-700 border-red-200" },
};

// 支払期日までの残日数（マイナス＝超過）
function daysUntil(due: string | null): number | null {
  if (!due) return null;
  const d = new Date(due + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function daysSince(from: string | null): number | null {
  if (!from) return null;
  return Math.floor((Date.now() - new Date(from).getTime()) / 86400000);
}

export default function ReceivedInvoiceList() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: vendors = [] } = useVendors<{ id: number; name: string }>();

  // アップロードのフォーム状態。
  // 読み取り・手入力が終わったら、この画面では送らずに確認画面へ送り出す。
  // 事務が中身（とくに仕入先）を確かめる前に現場へ送れてしまうのを防ぐため。
  const [reading, setReading] = useState(false);
  const [manual, setManual] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/received-invoices"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/received-invoices`);
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<{ items: InvoiceRow[]; hasMore?: boolean }>;
    },
  });
  const items = data?.items ?? [];

  const drafts = items.filter((i) => i.status === "draft");
  const pending = items.filter((i) => i.status === "sent");
  const waiting = items.filter((i) => i.status === "answered");
  const confirmed = items.filter((i) => i.status === "confirmed");
  // 確定前ぜんぶの未割当。下書きのまま止まっている分も原価に入っていないので数える。
  const unassignedTotal = [...drafts, ...pending, ...waiting].reduce((s, i) => s + i.unassignedAmount, 0);

  // 一覧のタブ。使い続けると確定済がたまり、対応が要るものが埋もれるため既定は「対応中」。
  const [tab, setTab] = useState<"open" | "confirmed" | "all">("open");
  const shown = tab === "open" ? items.filter((i) => i.status !== "confirmed")
    : tab === "confirmed" ? confirmed
    : items;

  // ── AI読み取り → 受領請求書を作成 ─────────────────────────────────────────
  const handleFile = async (file: File) => {
    setReading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });

      const ex = await fetch(`${BASE}/api/ai-extract/purchase-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mediaType: file.type || "application/pdf" }),
      });
      if (!ex.ok) {
        const e = await ex.json().catch(() => ({}));
        // AIキーが未設定のときは、環境変数の話を使う人に見せても手が止まるだけなので
        // 手入力へ案内する。
        if (ex.status === 503) {
          throw new Error("AIの読み取りは今は使えません。下の「AIを使わず手で入力する」からお願いします。");
        }
        throw new Error(e.message ?? "AI読み取りに失敗しました");
      }
      const { draft, vendorMatches, amountMismatch, amountDiff } = await ex.json();

      // 仕入先マスタの候補（完全一致 or 最有力）を初期値にする
      const vendorId: number | null = vendorMatches?.[0]?.id ?? null;

      const create = await fetch(`${BASE}/api/received-invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          vendorName: draft.vendorName ?? "",
          invoiceDate: draft.invoiceDate || null,
          paymentDueDate: draft.paymentDueDate || null,
          subtotal: draft.subtotal ?? 0,
          taxAmount: draft.taxAmount ?? 0,
          totalAmount: draft.totalAmount ?? 0,
          aiExtracted: true,
          amountMismatch: !!amountMismatch,
          items: draft.items ?? [],
          fileBase64: base64,
          mediaType: file.type || "application/pdf",
        }),
      });
      if (!create.ok) throw new Error("受領請求書の作成に失敗しました");
      const { id } = await create.json();

      const lines = (draft.items ?? []).length;
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
      toast({
        title: "読み取り完了",
        description: amountMismatch
          ? `${lines}行を読み取りました。金額が${formatCurrency(Math.abs(amountDiff ?? 0))}ずれています。内容を確かめてください。`
          : `${lines}行を読み取りました。内容を確かめてから現場に送ってください。`,
      });
      // 確認画面へ。ここで仕入先・日付・明細を確かめてから現場に送る。
      navigate(`/received-invoices/${id}`);
    } catch (e) {
      toast({ title: "エラー", description: e instanceof Error ? e.message : "読み取りに失敗しました", variant: "destructive" });
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const delMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "削除に失敗しました");
    },
    onSuccess: () => {
      toast({ title: "削除しました" });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
    },
    onError: (e) => toast({ title: "削除できません", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <FileScan className="w-6 h-6 text-primary" />
          仕入の振り分け
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          届いた請求書・納品書をデータ化して現場担当者に送り、明細ごとに工事を選んでもらいます。
        </p>
      </div>

      {/* サマリー。下書き（未送信）を先頭に置く。どのKPIにも出ないと送り忘れが放置される。 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="border-none bg-slate-50">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">下書き（未送信）</div>
            <div className={`text-2xl font-bold ${drafts.length > 0 ? "text-amber-600" : "text-slate-400"}`}>{drafts.length}</div>
          </CardContent>
        </Card>
        <Card className="border-none bg-slate-50">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">未回答</div>
            <div className={`text-2xl font-bold ${pending.length > 0 ? "text-amber-600" : "text-slate-400"}`}>{pending.length}</div>
          </CardContent>
        </Card>
        <Card className="border-none bg-slate-50">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">確認待ち</div>
            <div className={`text-2xl font-bold ${waiting.length > 0 ? "text-blue-600" : "text-slate-400"}`}>{waiting.length}</div>
          </CardContent>
        </Card>
        <Card className="border-none bg-slate-50">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">確定前の未割当</div>
            <div className={`text-2xl font-bold ${unassignedTotal > 0 ? "text-amber-600" : "text-slate-400"}`}>{formatCurrency(unassignedTotal)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">まだ原価に入っていない額</div>
          </CardContent>
        </Card>
        <Card className="border-none bg-slate-50">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">確定済</div>
            <div className="text-2xl font-bold text-emerald-600">{confirmed.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* 取り込み。送信はこの画面では行わず、確認画面（詳細）で行う */}
      <Card>
        <CardHeader className="py-3 border-b">
          <CardTitle className="text-sm font-semibold text-slate-700">書類を取り込む</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          {manual ? (
            <ManualEntry
              onCancel={() => setManual(false)}
              onCreated={(id) => {
                setManual(false);
                qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
                navigate(`/received-invoices/${id}`);
              }}
            />
          ) : (
            <div className="space-y-3">
            <button
              type="button"
              disabled={reading}
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-200 rounded-lg py-10 text-center hover:border-primary hover:bg-slate-50 transition-colors disabled:opacity-60"
            >
              {reading ? (
                <div className="flex flex-col items-center gap-2 text-slate-600">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-sm font-medium">AIが読み取っています…</span>
                  <span className="text-xs text-slate-400">30秒〜2分ほどかかります（明細が多いほど長くなります）</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-6 h-6 text-slate-400" />
                  <span className="text-sm font-semibold text-slate-700">請求書・納品書のPDF・写真を選ぶ</span>
                  <span className="text-xs text-slate-400">AIが読み取ったあと、内容を確かめる画面が開きます</span>
                </div>
              )}
            </button>
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => setManual(true)}
                className="text-sm text-slate-500 hover:text-primary flex items-center gap-1.5 underline underline-offset-2"
              >
                <PencilLine className="w-3.5 h-3.5" />
                AIを使わず手で入力する
              </button>
            </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 一覧 */}
      <Card>
        <CardHeader className="py-3 border-b space-y-2">
          <div className="flex flex-row items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm font-semibold text-slate-700">受け取った書類</CardTitle>
            <span className="text-xs text-slate-400">確定前のものを、支払期日が近い順に並べています</span>
          </div>
          <div className="flex items-center gap-1">
            {([
              { key: "open" as const, label: `対応中 ${items.filter((i) => i.status !== "confirmed").length}` },
              { key: "confirmed" as const, label: `確定済 ${confirmed.length}` },
              { key: "all" as const, label: "すべて" },
            ]).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3 py-1 rounded-md text-xs transition-colors ${
                  tab === t.key ? "bg-primary/10 text-primary font-semibold" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-10 text-center text-slate-400">読み込み中…</div>
          ) : shown.length === 0 ? (
            <div className="py-10 text-center text-slate-400">
              {items.length === 0 ? "まだ受け取った書類がありません"
                : tab === "open" ? "対応が必要な書類はありません"
                : "確定済の書類はありません"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[840px]">
                <thead>
                  <tr className="border-b bg-slate-50 text-xs text-slate-500">
                    <th className="text-left px-4 py-2.5">書類</th>
                    <th className="text-left px-4 py-2.5">送り先</th>
                    <th className="text-left px-4 py-2.5">状態</th>
                    <th className="text-right px-4 py-2.5">経過</th>
                    <th className="text-right px-4 py-2.5">支払期日</th>
                    <th className="text-right px-4 py-2.5">未割当</th>
                    <th className="text-right px-4 py-2.5">進捗</th>
                    <th className="px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((inv) => {
                    const st = STATUS_LABEL[inv.status] ?? STATUS_LABEL["draft"];
                    const left = daysUntil(inv.paymentDueDate);
                    const elapsed = daysSince(inv.sentAt);
                    const urgent = inv.status === "sent" && left != null && left <= 7;
                    return (
                      <tr key={inv.id} className={`border-b hover:bg-slate-50/60 transition-colors ${urgent ? "bg-amber-50/60" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800 flex items-center gap-2">
                            {inv.vendorName || "（仕入先不明）"}
                            {inv.amountMismatch && (
                              <span title="明細合計と請求総額が不一致">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500">
                            {inv.invoiceDate ?? "日付なし"} ・ {formatCurrency(inv.totalAmount)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {inv.recipients.length === 0 ? (
                              inv.status === "draft"
                                ? <span className="text-xs text-amber-600">未送信</span>
                                : <span className="text-xs text-slate-400">—</span>
                            ) : inv.recipients.map((r) => (
                              <Badge key={r.staffMemberId} variant="outline" className={`text-xs ${r.respondedAt ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}`}>
                                {r.name}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {/* 複数人に送った書類は、全員が返すまで「未回答」のままになる。
                              一部が返している途中と、誰も手を付けていないのは別物なので分ける。 */}
                          {inv.status === "sent" && inv.recipients.some((r) => r.respondedAt) ? (
                            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                              一部回答 {inv.recipients.filter((r) => r.respondedAt).length}/{inv.recipients.length}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className={`text-xs ${st.cls}`}>{st.label}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {elapsed == null ? <span className="text-slate-300">—</span> : <span className={elapsed >= 5 ? "font-semibold text-amber-600" : "text-slate-600"}>{elapsed}日</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                          {inv.paymentDueDate ?? "—"}
                          {left != null && inv.status !== "confirmed" && (
                            <div className={`text-xs ${left <= 7 ? "text-amber-600 font-medium" : "text-slate-400"}`}>
                              {left >= 0 ? `あと${left}日` : `${-left}日超過`}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={inv.unassignedAmount > 0 ? "font-semibold text-amber-600" : "text-emerald-600"}>
                            {formatCurrency(inv.unassignedAmount)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full transition-all"
                                style={{ width: `${inv.blockCount > 0 ? (inv.assignedBlockCount / inv.blockCount) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500 tabular-nums">{inv.assignedBlockCount}/{inv.blockCount}</span>
                          </div>
                        </td>
                        <td className="px-2">
                          <div className="flex items-center gap-0.5">
                            {inv.status !== "confirmed" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-300 hover:text-red-500"
                                title="削除"
                                onClick={() => {
                                  if (confirm(`${inv.vendorName || "この書類"}を削除しますか？\n原本の画像も一緒に消えます。`)) {
                                    delMut.mutate(inv.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                            <Link href={`/received-invoices/${inv.id}`}>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-primary">
                                <ChevronRight className="w-4 h-4" />
                              </Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data?.hasMore && (
                <p className="px-4 py-2.5 text-xs text-slate-400 border-t">
                  古い書類は表示していません（新しい300件まで）。確定前のものはすべてこの中にあります。
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {vendors.length === 0 && (
        <p className="text-xs text-slate-400">※ 仕入先マスタが未登録です。確定するには仕入先の登録が必要です。</p>
      )}
    </div>
  );
}
