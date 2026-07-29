import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, FileText, AlertTriangle, CheckCircle2, Send, ChevronDown, ChevronUp, Trash2, PencilLine, Plus, Undo2 } from "lucide-react";
import { InvoiceEditor } from "./editor";
import { useToast } from "@/hooks/use-toast";
import { useVendors } from "@/hooks/use-vendors";
import { useStaffMembers } from "@/hooks/use-staff-members";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// 「自分の現場」で選んだ担当者。誰が回答したかを記録するために引き継ぐ。
const STAFF_KEY = "cmc.myProjects.staffName";

interface Line {
  id: number;
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
  /** 担当者が「返す」を押して固定された。差し戻すまで変更できない */
  locked: boolean;
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
  /** 同じ仕入先・請求日・請求額の書類（二重取り込みの疑い） */
  duplicates: { id: number; status: string; createdAt: string }[];
}
interface Project { id: number; name: string; projectCode: string; siteManager?: string | null }

const NONE = "__none__";

export default function ReceivedInvoiceDetail({ id }: { id: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // 事務が中身を直しているあいだ。下書きのときだけ入れる。
  const [editing, setEditing] = useState(false);
  // 仕入先マスタに登録する社名。AIが読んだ名前を初期値にし、打ち替えられるようにする
  // （手書きだと空で返る／宛先を発行元と取り違えることがある）。
  const [vendorNameInput, setVendorNameInput] = useState<string | null>(null);
  // 明細は既定で見せる。ブロックの見出し（納品書No・納品先）に判断材料が無い請求書
  // （いわさき工房のように納品先の印字が無いもの）では、品名が唯一の手掛かりになるため。
  // 行数が多いブロックだけ畳む（大田鋼管のような多明細でスクロールが辛くならないように）。
  const COLLAPSE_OVER = 6;

  const { data: vendors = [] } = useVendors<{ id: number; name: string }>();
  const { data: staff = [] } = useStaffMembers();
  // 下書きから現場へ送るための送り先選択。作成直後の一時状態に頼ると、
  // 画面を離れた時点で送る手段が無くなり下書きが取り残される（実際に起きた）。
  const [selectedStaff, setSelectedStaff] = useState<number[]>([]);

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
      // 誰が選んだかを一緒に送る。「返す」でその人の分だけを固定するために使う。
      const me = staff.find((x) => x.name === localStorage.getItem(STAFF_KEY));
      const r = await fetch(`${BASE}/api/received-invoices/${id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments: a.itemIds.map((itemId) => ({ itemId, projectId: a.projectId })),
          ...(me ? { staffMemberId: me.id } : {}),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "保存に失敗しました");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] }),
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const respondMut = useMutation({
    mutationFn: async () => {
      const myName = localStorage.getItem(STAFF_KEY);
      const me = staff.find((x) => x.name === myName);
      const r = await fetch(`${BASE}/api/received-invoices/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(me ? { staffMemberId: me.id } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? "送信に失敗しました");
      return j as { status: string; unassignedCount: number };
    },
    onSuccess: (j) => {
      toast(
        j.status === "answered"
          ? { title: "事務に返しました", description: "事務が確認して確定します。" }
          : {
              title: "自分の分を返しました",
              description: `残り${j.unassignedCount}行は他の担当者が選びます。全部そろうと事務の確認待ちになります。`,
            },
      );
      qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
    },
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  // AIが読んだ社名がマスタに無い場合の逃げ道。マスタ画面へ往復せず、その場で登録して
  // そのまま紐づける。締め日・支払日は既定値（末締め・翌月25日）で入るので、
  // 細かい条件はあとから仕入先マスタで直す。
  const createVendorMut = useMutation({
    mutationFn: async (name: string) => {
      const r = await fetch(`${BASE}/api/vendors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "仕入先の登録に失敗しました");
      const created = await r.json();
      const newId = created?.id ?? created?.vendor?.id;
      if (!newId) throw new Error("登録した仕入先のIDが取得できませんでした");
      const link = await fetch(`${BASE}/api/received-invoices/${id}/vendor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId: Number(newId) }),
      });
      if (!link.ok) throw new Error("仕入先の紐づけに失敗しました");
    },
    onSuccess: () => {
      toast({ title: "仕入先に登録しました", description: "締め日・支払日は初期値です。必要なら仕入先マスタで直してください。" });
      qc.invalidateQueries({ queryKey: ["/api/vendors"] });
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

  const sendMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffMemberIds: selectedStaff }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "送信に失敗しました");
    },
    onSuccess: () => {
      toast({ title: "現場に送信しました", description: "現場担当者が工事を選ぶと、確認待ちになります。" });
      setSelectedStaff([]);
      qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
      // 事務の作業はここで完了。この先は現場担当者の画面なので一覧へ戻す
      navigate("/received-invoices");
    },
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const reopenMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}/reopen`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "差し戻しに失敗しました");
    },
    onSuccess: () => {
      toast({ title: "現場に差し戻しました", description: "現場担当者の「届いている書類」に戻り、選び直せます。" });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
    },
    onError: (e) => toast({ title: "エラー", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });

  const unconfirmMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/received-invoices/${id}/unconfirm`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? "確定の取り消しに失敗しました");
      return j as { deleted: string[] };
    },
    onSuccess: (j) => {
      toast({
        title: "確定を取り消しました",
        description: `仕入伝票${j.deleted.length}件（${j.deleted.join(", ")}）と原価を取り消し、確認待ちに戻しました。`,
      });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] });
      qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      qc.invalidateQueries({ queryKey: ["/api/cost-items"] });
    },
    onError: (e) => toast({ title: "取り消せません", description: e instanceof Error ? e.message : "", variant: "destructive" }),
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
  // 現場から返ってきた書類は工事を選び直せない（事務が見た内容と確定される内容が
  // 食い違わないようにする）。直すときは差し戻す。
  const assignLocked = locked || data?.status === "answered";

  if (isLoading) {
    return <div className="p-6 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  }
  if (!data) {
    return <div className="p-6 text-center text-slate-400">見つかりませんでした</div>;
  }

  // 分母は仕入行の合計（税抜）。請求総額は税込なので、これを分母にすると
  // 0割当でもバーが伸びてしまう。
  const linkedVendorName = data.vendorId ? (vendors.find((v) => v.id === data.vendorId)?.name ?? "") : "";

  // 請求日が極端に古い／先すぎるときの安全網。手書きの元号をAIが読み違えると
  // （令和8年→平成28年＝2016年）、そのまま確定すると原価が別の年に入ってしまう。
  const invoiceYear = data.invoiceDate ? Number(data.invoiceDate.slice(0, 4)) : null;
  const thisYear = new Date().getFullYear();
  const dateLooksWrong = invoiceYear != null && (invoiceYear < thisYear - 2 || invoiceYear > thisYear + 1);

  // 入力欄の値。未編集ならAIが読んだ社名を初期値にする。
  const vendorNameDraft = vendorNameInput ?? data.vendorName ?? "";

  // 似た名前の既存仕入先。「登録」を押す前に見せて、同じ会社を二重に作るのを防ぐ。
  // 突合の正規化はAI読み取り側（ai-extract.ts）と同じ考え方に揃えている。
  const strip = (s: string) => s.replace(/\s|株式会社|（株）|\(株\)|有限会社|（有）|\(有\)/g, "");
  const needle = strip(vendorNameDraft);
  const similarVendors = !data.vendorId && needle.length > 0
    ? vendors.filter((v) => {
        const hay = strip(v.name);
        return hay.length > 0 && (hay.includes(needle) || needle.includes(hay));
      }).slice(0, 3)
    : [];

  const purchaseTotal = purchaseBlocks.reduce((s, b) => s + b.amount, 0);
  // 「自分の現場」で選んだ名前。自分が担当している工事を先に出して、実データの
  // 工事数（本番は今後増える）でも選びやすくする。
  const myStaffName = localStorage.getItem(STAFF_KEY);
  const myProjects = myStaffName ? projects.filter((p) => p.siteManager === myStaffName) : [];
  const otherProjects = projects.filter((p) => !myProjects.includes(p));

  const nonPurchaseTotal = data.blocks
    .flatMap((b) => b.lines)
    .filter((l) => l.isNonPurchase)
    .reduce((s, l) => s + l.amount, 0);
  const progress = purchaseTotal > 0
    ? Math.max(0, Math.min(100, ((purchaseTotal - data.unassignedAmount) / purchaseTotal) * 100))
    : 0;

  return (
    // 現場はスマホなので普段は3xl。事務が明細を直すときだけ横に広げる（列が多いため）
    <div className={`p-4 sm:p-6 mx-auto space-y-4 ${editing ? "max-w-6xl" : "max-w-3xl"}`}>
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
              if (confirm(`${data.vendorName || "この書類"}を削除しますか？\n原本の画像も一緒に消えます。`)) {
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
              {data.status === "sent" && <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 mb-1">未回答</Badge>}
              {data.status === "answered" && <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 mb-1">確認待ち</Badge>}
              {data.status === "confirmed" && <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 mb-1">確定済</Badge>}
              {data.status === "draft" && <Badge variant="outline" className="mb-1">下書き</Badge>}
              {!data.vendorId && data.status !== "cancelled" && (
                <Badge variant="outline" className="mb-1 ml-1 bg-amber-100 text-amber-700 border-amber-200">仕入先 未確定</Badge>
              )}
              {/* 紐づけ済みならマスタの正式名を出す。AIが読んだ名前（空のことも多い）より
                  そちらが正しい。 */}
              <h1 className="text-lg font-bold text-slate-900 leading-snug">
                {linkedVendorName || data.vendorName || "（仕入先不明）"}
              </h1>
              {!data.vendorId && data.vendorName && (
                <p className="text-xs text-amber-700 mt-0.5">
                  {data.aiExtracted ? "AIが読んだ社名です。" : "入力された社名です。"}仕入先マスタと結びついていません。
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {data.status === "draft" && !editing && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
                  <PencilLine className="w-4 h-4" /> 内容を直す
                </Button>
              )}
              {data.hasFile && (
                <a href={`${BASE}/api/received-invoices/${id}/file`} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <FileText className="w-4 h-4" /> 原本
                  </Button>
                </a>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">請求日</dt><dd className="tabular-nums">{data.invoiceDate ?? "—"}</dd>
            <dt className="text-slate-500">支払期日</dt><dd className="tabular-nums">{data.paymentDueDate ?? "—"}</dd>
            <dt className="text-slate-500">請求額</dt><dd className="tabular-nums font-medium">{formatCurrency(data.totalAmount)}</dd>
            {/* 未割当は「仕入対象（税抜）」が分母。請求額（税込・入金相殺後）と並ぶと
                金額が逆転して見えるため、分母をそのまま出しておく。 */}
            <dt className="text-slate-500">仕入対象</dt>
            <dd className="tabular-nums">
              {formatCurrency(purchaseTotal)}
              <span className="text-xs text-slate-400 ml-1.5">税抜・工事に割り当てる分</span>
            </dd>
            <dt className="text-slate-500">明細</dt><dd>{data.blocks.reduce((s, b) => s + b.lineCount, 0)}行 ─ {purchaseBlocks.length}ブロック</dd>
          </dl>

          {nonPurchaseTotal !== 0 && (
            <p className="text-xs text-slate-500">
              入金・値引などの {formatCurrency(nonPurchaseTotal)} は請求額から差し引かれています。原価には計上しません。
            </p>
          )}

          {data.amountMismatch && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              {/* どちらの数字がどうずれているかと、直す場所まで書く。
                  「一致していません」だけでは、何をどこで直すのか分からない。 */}
              <span>
                明細から計算した合計 {formatCurrency(purchaseTotal + data.taxAmount + nonPurchaseTotal)} が、
                請求額 {formatCurrency(data.totalAmount)} と合っていません。
                {data.status === "draft"
                  ? "「内容を直す」から、明細か請求額を直してください。"
                  : "原本を確認してください。"}
              </span>
            </div>
          )}

          {/* 同じ請求書を2回取り込むと、確定した分だけ原価が増える。止めはしないが、
              確定する前に必ず目に入る場所で知らせる。 */}
          {(data.duplicates ?? []).length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <div className="space-y-1">
                <p className="font-semibold">同じ内容の書類がすでにあります（二重計上に注意）</p>
                <p>仕入先・請求日・請求額がすべて同じものが{data.duplicates.length}件あります。</p>
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  {data.duplicates.map((d) => (
                    <Link key={d.id} href={`/received-invoices/${d.id}`}>
                      <span className="underline underline-offset-2 cursor-pointer">
                        {d.createdAt.slice(0, 10)} 取り込み・
                        {d.status === "confirmed" ? "確定済" : d.status === "answered" ? "確認待ち" : d.status === "sent" ? "未回答" : "下書き"}
                      </span>
                    </Link>
                  ))}
                </p>
                <p className="text-amber-700">
                  別々の請求である場合はそのまま進めてください。取り違えなら、この書類を削除してください。
                </p>
              </div>
            </div>
          )}

          {dateLooksWrong && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>
                請求日が {data.invoiceDate} になっています。和暦の読み違いかもしれません
                （令和8年を平成28年と読むと2016年になります）。原本を確認してください。
              </span>
            </div>
          )}

          {/* 残額バー */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">未割当（仕入対象のうち）</span>
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

      {/* 事務の確認。現場に送る前に仕入先を確かめる場所。
          以前は送信ボタンより下（しかも回答が返ってきてから）にあり、仕入先が
          未確定のまま現場に送られていた。
          編集中も出しておく（隠すと「内容を直す」を押した瞬間に社名へ触れなくなる）。 */}
      {!locked && (data.status !== "sent" || !data.vendorId) && (
        <Card className={!data.vendorId ? "border-amber-300 bg-amber-50/40" : undefined}>
          <CardContent className="p-4 space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">仕入先</label>
            <Select
              value={data.vendorId ? String(data.vendorId) : undefined}
              onValueChange={(v) => vendorMut.mutate(Number(v))}
            >
              <SelectTrigger className={`h-11 ${!data.vendorId ? "border-amber-400 text-amber-700" : ""}`}>
                <SelectValue placeholder="仕入先を選ぶ" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]" searchPlaceholder="仕入先を検索">
                {vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {!data.vendorId && (
              <div className="pt-2 space-y-2">
                <p className="text-xs text-amber-700">
                  仕入先が決まらないと現場に送れません。原本を見て選んでください。
                </p>

                {similarVendors.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-600">似た仕入先があります：</span>
                    {similarVendors.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => vendorMut.mutate(v.id)}
                        className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs text-slate-700 hover:border-primary hover:text-primary"
                      >
                        {v.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* 社名は打ち替えられるようにする。手書きの請求書ではAIが社名を読めない
                    （空で返る）ことも、宛先を発行元と取り違えることもあるため。 */}
                <div className="space-y-1">
                  <label className="text-xs text-slate-600">マスタに無い仕入先はここから登録できます</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={vendorNameDraft}
                      onChange={(e) => setVendorNameInput(e.target.value)}
                      placeholder="請求書に書かれている会社名"
                      className="h-9 max-w-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={vendorNameDraft.trim() === "" || createVendorMut.isPending}
                      onClick={() => createVendorMut.mutate(vendorNameDraft.trim())}
                    >
                      {createVendorMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      この名前で登録して使う
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500">
                    締め日・支払日は初期値（末締め・翌月25日）で入ります。必要なら後で仕入先マスタで直してください。
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {editing && data.status === "draft" && (
        <InvoiceEditor
          invoiceId={id}
          invoiceDate={data.invoiceDate}
          paymentDueDate={data.paymentDueDate}
          totalAmount={data.totalAmount}
          aiExtracted={data.aiExtracted}
          lines={data.blocks.flatMap((b) => b.lines)}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            qc.invalidateQueries({ queryKey: ["/api/received-invoices", id] });
            qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });
          }}
        />
      )}

      {/* ブロック一覧 */}
      <div className={`space-y-3 ${editing ? "hidden" : ""}`}>
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
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                      工事
                      {b.locked && !assignLocked && (
                        <span className="font-normal normal-case tracking-normal text-emerald-700">
                          ・回答済み（変更するには差し戻しが必要です）
                        </span>
                      )}
                    </label>
                    <Select
                      value={b.projectId ? String(b.projectId) : NONE}
                      disabled={assignLocked || b.locked || assignMut.isPending}
                      onValueChange={(v) => assignMut.mutate({ itemIds: b.itemIds, projectId: v === NONE ? null : Number(v) })}
                    >
                      <SelectTrigger className={`h-11 ${!assigned ? "border-amber-400 text-amber-700" : ""}`}>
                        <SelectValue placeholder="選択してください" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]" searchPlaceholder="工事名で検索">
                        <SelectItem value={NONE} className="text-slate-400">（未選択）</SelectItem>
                        {myProjects.length > 0 && (
                          <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">自分の担当</div>
                        )}
                        {myProjects.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            <span className="font-mono text-xs text-slate-400 mr-1.5">{p.projectCode}</span>
                            {p.name}
                          </SelectItem>
                        ))}
                        {myProjects.length > 0 && otherProjects.length > 0 && (
                          <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 border-t mt-1 pt-1.5">その他の工事</div>
                        )}
                        {otherProjects.map((p) => (
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
      {!editing && !locked && (
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
              <>
                <div className="text-xs text-slate-500 bg-slate-50 rounded px-2 py-1.5 space-y-1">
                  <p>
                    ここから先は現場担当者（{data.recipients.map((r) => r.name).join("・") || "未設定"}）の操作です。
                    {data.recipients.length > 1
                      ? "自分が分かる分だけ選んで返せます。残りは他の方が選びます。"
                      : "工事を選び終えたら事務に返してください。"}
                  </p>
                  {/* 複数人に送っているときは、誰がもう返したかを見せる。
                      これが無いと「自分が待つ番なのか」が誰にも分からない。 */}
                  {data.recipients.length > 1 && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {data.recipients.map((r) => (
                        <span key={r.staffMemberId} className={r.respondedAt ? "text-emerald-700" : "text-slate-500"}>
                          {r.name}
                          {r.respondedAt ? "：回答済み" : "：まだ"}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                <Button className="w-full h-11" disabled={respondMut.isPending} onClick={() => respondMut.mutate()}>
                  {respondMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  {done
                    ? "割当を完了して事務に返す"
                    : `自分の分を返す（残り${purchaseBlocks.length - assignedCount}ブロックは他の方へ）`}
                </Button>
                {/* 先に返した人の分は固定されるので、間違いに気づいたときの逃げ道を
                    途中の状態でも用意する。 */}
                {data.recipients.some((r) => r.respondedAt) && (
                  <Button
                    variant="outline"
                    className="w-full gap-1.5"
                    disabled={reopenMut.isPending}
                    onClick={() => {
                      if (confirm("回答済みの分を選び直せるようにしますか？\n全員の「回答済み」が外れ、最初から選び直せる状態に戻ります。")) {
                        reopenMut.mutate();
                      }
                    }}
                  >
                    {reopenMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                    回答済みの分を選び直せるようにする
                  </Button>
                )}
              </>
            )}

            {data.status === "draft" && (
              <div className="space-y-2 pb-3 mb-3 border-b">
                <div className="text-xs font-medium text-slate-600">送り先（複数選べます）</div>
                <div className="flex flex-wrap gap-2">
                  {staff.filter((x) => x.isActive).map((x) => {
                    const on = selectedStaff.includes(x.id);
                    return (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => setSelectedStaff((p) => (on ? p.filter((y) => y !== x.id) : [...p, x.id]))}
                        className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                          on ? "border-primary bg-primary/10 text-primary font-semibold" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {x.name}
                      </button>
                    );
                  })}
                </div>
                <Button
                  className="w-full h-11"
                  disabled={selectedStaff.length === 0 || !data.vendorId || sendMut.isPending}
                  onClick={() => sendMut.mutate()}
                >
                  {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  この内容で現場に送る
                </Button>
                {!data.vendorId && (
                  <p className="text-xs text-amber-700">上の「仕入先」を選ぶと送れます。</p>
                )}
                <p className="text-xs text-slate-400">現場に送らず、事務がここで工事を選んで確定することもできます。</p>
              </div>
            )}

            {/* 送信済みでも全部埋まっていれば確定できるようにする。誰も「返す」を
                押さないまま割当だけ終わった書類が、確定できずに残るのを防ぐ。 */}
            {(data.status === "answered" || data.status === "draft" || (data.status === "sent" && done)) && (
              <div className="space-y-2">
                {!data.vendorId && (
                  <p className="text-xs text-amber-700">上の「仕入先」を選ぶと確定できます。</p>
                )}
                {data.status === "answered" && (
                  <p className="text-xs text-slate-500 bg-slate-50 rounded px-2 py-1.5">
                    現場から返ってきました。工事はここでは変えられません。
                    直すときは差し戻して、現場に選び直してもらってください。
                  </p>
                )}
                <Button
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-700"
                  disabled={!done || !data.vendorId || confirmMut.isPending}
                  onClick={() => confirmMut.mutate()}
                >
                  {confirmMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  確定して仕入伝票をつくる
                </Button>
                {data.status === "answered" && (
                  <Button
                    variant="outline"
                    className="w-full gap-1.5"
                    disabled={reopenMut.isPending}
                    onClick={() => {
                      if (confirm("現場に差し戻しますか？\n工事の選択はそのまま残り、現場が選び直せる状態に戻ります。")) {
                        reopenMut.mutate();
                      }
                    }}
                  >
                    {reopenMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                    現場に差し戻す
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.status === "confirmed" && (
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                確定済みです。工事ごとの仕入伝票が作られ、原価に計上されました。
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/purchases")}>仕入を見る</Button>
            </div>
            {/* 工事を間違えたまま確定したときの直し方。伝票を手で消して作り直す運用を置き換える。 */}
            <div className="border-t border-emerald-200 pt-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={unconfirmMut.isPending}
                onClick={() => {
                  if (
                    confirm(
                      "確定を取り消しますか？\n\n" +
                      "・この書類から作られた仕入伝票と原価が消えます\n" +
                      "・その分、工事の原価が減ります\n" +
                      "・書類は確認待ちに戻ります（工事の選択は残ります）\n\n" +
                      "支払済・査定済の伝票があるときは取り消せません。",
                    )
                  ) {
                    unconfirmMut.mutate();
                  }
                }}
              >
                {unconfirmMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                確定を取り消す
              </Button>
              <p className="text-xs text-emerald-700 mt-1.5">
                工事を間違えて確定したときはここから取り消し、差し戻して現場に選び直してもらってください。
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
