import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileScan, Send, ChevronRight, AlertTriangle, Sparkles, PencilLine, Trash2 } from "lucide-react";
import { ManualEntry } from "./manual-entry";
import { useToast } from "@/hooks/use-toast";
import { useStaffMembers } from "@/hooks/use-staff-members";
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
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: staff = [] } = useStaffMembers();
  const { data: vendors = [] } = useVendors<{ id: number; name: string }>();

  // アップロード〜送信のフォーム状態
  const [reading, setReading] = useState(false);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [draftSummary, setDraftSummary] = useState<{ vendorName: string; total: number; lines: number; blocks: number; mismatch: boolean; diff?: number; ai: boolean } | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<number[]>([]);
  const [manual, setManual] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/received-invoices"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/received-invoices`);
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<{ items: InvoiceRow[] }>;
    },
  });
  const items = data?.items ?? [];

  const pending = items.filter((i) => i.status === "sent");
  const waiting = items.filter((i) => i.status === "answered");
  const unassignedTotal = pending.reduce((s, i) => s + i.unassignedAmount, 0);
  const confirmedThisMonth = items.filter((i) => i.status === "confirmed").length;

  // ── AI読み取り → 受領請求書を作成 ─────────────────────────────────────────
  const handleFile = async (file: File) => {
    setReading(true);
    setDraftId(null);
    setDraftSummary(null);
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
      const slips = new Set((draft.items ?? []).filter((x: { slipNo?: string }) => x.slipNo).map((x: { slipNo?: string }) => x.slipNo));
      setDraftId(id);
      setDraftSummary({
        vendorName: draft.vendorName ?? "",
        total: draft.totalAmount ?? 0,
        lines,
        blocks: slips.size > 0 ? slips.size : lines,
        mismatch: !!amountMismatch,
        diff: amountDiff ?? 0,
        ai: true,
      });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
      toast({ title: "読み取り完了", description: `${lines}行を読み取りました。送り先を選んで送信してください。` });
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

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!draftId) throw new Error("先に書類を読み取ってください");
      const r = await fetch(`${BASE}/api/received-invoices/${draftId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffMemberIds: selectedStaff }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "送信に失敗しました");
    },
    onSuccess: () => {
      toast({ title: "送信しました", description: `${selectedStaff.length}名に送りました。` });
      setDraftId(null);
      setDraftSummary(null);
      setSelectedStaff([]);
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
    },
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const activeStaff = staff.filter((s) => s.isActive);

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

      {/* サマリー */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-none bg-slate-50">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">未回答</div>
            <div className={`text-2xl font-bold ${pending.length > 0 ? "text-amber-600" : "text-slate-400"}`}>{pending.length}</div>
          </CardContent>
        </Card>
        <Card className="border-none bg-slate-50">
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">未割当の合計</div>
            <div className={`text-2xl font-bold ${unassignedTotal > 0 ? "text-amber-600" : "text-slate-400"}`}>{formatCurrency(unassignedTotal)}</div>
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
            <div className="text-xs text-slate-500">確定済</div>
            <div className="text-2xl font-bold text-emerald-600">{confirmedThisMonth}</div>
          </CardContent>
        </Card>
      </div>

      {/* アップロード＆送信 */}
      <Card>
        <CardHeader className="py-3 border-b">
          <CardTitle className="text-sm font-semibold text-slate-700">書類を送る</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          {!draftSummary && manual ? (
            <ManualEntry
              onCancel={() => setManual(false)}
              onCreated={(id, summary) => {
                setManual(false);
                setDraftId(id);
                setDraftSummary({ ...summary, mismatch: false, diff: 0, ai: false });
                qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
              }}
            />
          ) : !draftSummary ? (
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
                  <span className="text-xs text-slate-400">AIが読み取って、送り先を選ぶだけで現場に届きます</span>
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
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4 rounded-lg border bg-emerald-50/50 border-emerald-200 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                    <Sparkles className="w-4 h-4" />
                    {draftSummary.ai ? "読み取りました" : "入力しました"}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {draftSummary.vendorName || "（仕入先不明）"} ／ {formatCurrency(draftSummary.total)}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {draftSummary.lines}行 ─ {draftSummary.blocks}ブロック
                  </div>
                  {draftSummary.mismatch && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      明細の合計が請求額と{draftSummary.diff && draftSummary.diff !== 0
                        ? `${formatCurrency(Math.abs(draftSummary.diff))}ずれています`
                        : "一致しません"}。内容を確認してください。
                    </div>
                  )}
                </div>
                <Link href={`/received-invoices/${draftId}`}>
                  <Button variant="outline" size="sm">内容を見る</Button>
                </Link>
              </div>

              <div>
                <div className="text-xs font-medium text-slate-600 mb-2">送り先（複数選べます）</div>
                <div className="flex flex-wrap gap-2">
                  {activeStaff.map((s) => {
                    const on = selectedStaff.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedStaff((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                        className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                          on ? "border-primary bg-primary/10 text-primary font-semibold" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                  {activeStaff.length === 0 && (
                    <span className="text-sm text-slate-400">担当者マスタが未登録です</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={() => sendMut.mutate()} disabled={selectedStaff.length === 0 || sendMut.isPending} className="gap-2">
                  {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  現場に送信
                </Button>
                <button
                  type="button"
                  className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-2"
                  onClick={() => { setDraftId(null); setDraftSummary(null); setSelectedStaff([]); }}
                >
                  やめる
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 一覧 */}
      <Card>
        <CardHeader className="py-3 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-700">受け取った書類</CardTitle>
          <span className="text-xs text-slate-400">支払期日が近い順に注意してください</span>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-10 text-center text-slate-400">読み込み中…</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-slate-400">まだ受け取った書類がありません</div>
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
                  {items.map((inv) => {
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
                          <Badge variant="outline" className={`text-xs ${st.cls}`}>{st.label}</Badge>
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
