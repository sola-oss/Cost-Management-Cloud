import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { readOneFile, AiUnavailableError, type ImportStage } from "./received-invoices/import";
import {
  createScanDraft,
  SCAN_DRAFT_PAGE,
  SCAN_DRAFTS_QUERY_KEY,
  type ScanDraftKind,
  type ScanDraftRow,
} from "./scan-drafts";
import { ScanLine, FileText, Truck, Loader2, Keyboard, Upload, Trash2, ChevronRight } from "lucide-react";

// ─── スキャンする（読み込み）──────────────────────────────────────────────────
//
// おおつか様の依頼（2026-09-10）：書類のスキャンを起点に登録できるようにする。
// 書類の種類は①〜⑤。④下請納品書・⑤下請請求書は仕入の振り分けの下書きに、
// ①元請注文書・②客先見積書/契約書・③下請見積書はこの画面の「確認待ちの書類」に下書きとして並ぶ。
// ①②は工事登録の画面（/scan/prime-order・/scan/client-estimate）、③は実行予算に入れる画面
// （/scan/subcontract-estimate）を ?draft=ID で開いて、1件ずつ確かめて登録する。

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MAX_FILES = 10;

type DocType = {
  key: string;
  no: string;
  title: string;
  hint: string;
  stage?: ImportStage;
  // 仕入の振り分け以外の画面で読み込む書類は、その画面へ移る
  page?: string;
  icon: typeof FileText;
  ready: boolean;
  pending?: string;
};

const DOC_TYPES: DocType[] = [
  {
    key: "prime-order",
    no: "①",
    title: "元請からの注文書",
    hint: "工事を登録します（まだ確定でなければ仮登録）",
    page: "/scan/prime-order",
    icon: FileText,
    ready: true,
  },
  {
    key: "client-estimate",
    no: "②",
    title: "客先へ出した見積書・契約書",
    hint: "工事を登録します（まだ確定でなければ仮登録）",
    page: "/scan/client-estimate",
    icon: FileText,
    ready: true,
  },
  {
    key: "subcontract-estimate",
    no: "③",
    title: "下請の見積書",
    hint: "実行予算に入れます（工事が無ければその場で仮登録）",
    page: "/scan/subcontract-estimate",
    icon: FileText,
    ready: true,
  },
  {
    key: "subcontract-delivery",
    no: "④",
    title: "下請からの納品書",
    hint: "仮原価として記録します（請求書が届くまで原価には入れません）",
    stage: "provisional",
    icon: Truck,
    ready: true,
  },
  {
    key: "subcontract-invoice",
    no: "⑤",
    title: "下請からの請求書",
    hint: "確定原価として計上します",
    stage: "confirmed",
    icon: FileText,
    ready: true,
  },
  {
    key: "other",
    no: "",
    title: "その他の書類",
    hint: "①〜⑤に当てはまらない書類。紐づけ先を手で選びます",
    icon: FileText,
    ready: false,
    pending: "仕様を相談中",
  },
];

export default function Scan() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  // ①②③の確認待ち（取り込んだが、まだ登録していない書類）
  const { data: draftsData } = useQuery<{ items: ScanDraftRow[] }>({
    queryKey: SCAN_DRAFTS_QUERY_KEY,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/scan-drafts`);
      if (!r.ok) return { items: [] };
      return r.json();
    },
  });
  const drafts = draftsData?.items ?? [];
  const delDraft = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/scan-drafts/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "削除に失敗しました");
    },
    onSuccess: () => {
      toast({ title: "下書きを削除しました" });
      qc.invalidateQueries({ queryKey: SCAN_DRAFTS_QUERY_KEY });
    },
    onError: (e) => toast({ title: "削除できません", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<DocType | null>(null);
  // 下の取り込み枠で選んだ種類。上のカードとは別に持ち、選ぶまでは枠に入れても取り込まない
  const [dropType, setDropType] = useState<DocType | null>(null);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);

  // 読み取りはブラウザから1件ずつ投げている。画面を移っても続くが、タブを閉じると止まる。
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (!reading) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [reading]);

  // 上のカード：種類を押すとすぐファイル選択が開く。選んだ種類で段階が決まる
  const start = (t: DocType) => {
    setPicked(t);
    setTimeout(() => fileRef.current?.click(), 0);
  };

  // 下の取り込み枠（仕入の振り分けと同じ形）。選んだ種類で段階や読み取り先の画面が
  // 決まるので、種類を選ぶまでは押しても入れても取り込まない。
  const openDropPicker = () => {
    if (!dropType) {
      toast({ title: "先に書類の種類を選んでください", variant: "destructive" });
      return;
    }
    start(dropType);
  };

  const handleDrop = (files: File[]) => {
    if (!dropType) {
      toast({ title: "先に書類の種類を選んでください", description: "枠の上の①〜⑤から選んでから、もう一度入れてください。", variant: "destructive" });
      return;
    }
    handleFiles(files, dropType);
  };

  const readToDrafts = async (selected: File[], kind: ScanDraftKind) => {
    const files = selected.slice(0, MAX_FILES);
    const dropped = selected.length - files.length;
    setReading(true);
    const created: number[] = [];
    const failed: string[] = [];
    let unread = 0;
    let aiDown = false;
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length, current: files[i].name });
      try {
        const r = await createScanDraft(files[i], kind, aiDown);
        created.push(r.id);
        if (r.error) unread++;
      } catch (e) {
        if (e instanceof AiUnavailableError) {
          // 下書きは原本だけで作ってある。残りもAIを呼ばずに原本だけ残す
          aiDown = true;
          unread++;
          toast({ title: "AI読み取りが使えません", description: `${e.message} 原本だけ下書きに残すので、開いて手で入力してください。`, variant: "destructive" });
          continue;
        }
        failed.push(files[i].name);
      }
    }
    setProgress(null);
    setReading(false);
    if (fileRef.current) fileRef.current.value = "";
    qc.invalidateQueries({ queryKey: SCAN_DRAFTS_QUERY_KEY });

    // 1件だけで読めたなら、そのまま確認画面へ。それ以外は下の一覧に並べて、あとで1件ずつ確かめてもらう
    if (files.length === 1 && created.length === 1) {
      if (mounted.current) navigate(`${SCAN_DRAFT_PAGE[kind]}?draft=${created[0]}`);
      return;
    }
    const notes = [
      unread > 0 ? `${unread}件は読み取れなかったので、開いて手で入力してください。` : "",
      failed.length > 0 ? `${failed.join("、")}は取り込めませんでした。` : "",
      dropped > 0 ? `${dropped}件は上限（${MAX_FILES}件）を超えたので取り込んでいません。` : "",
    ].filter(Boolean);
    toast({
      title: `${files.length - failed.length}件を下書きにしました`,
      description: ["下の「確認待ちの書類」から1件ずつ開いて登録してください。", ...notes].join(" "),
      variant: failed.length > 0 ? "destructive" : undefined,
    });
  };

  const handleFiles = async (selected: File[], type: DocType | null = picked) => {
    // ①②③は読み取って下書きにしておき、確認は別ページで1件ずつ（④⑤の受領書類と同じ流れ）
    if (type?.page && selected.length > 0) {
      await readToDrafts(selected, type.key as ScanDraftKind);
      return;
    }
    if (selected.length === 0 || !type?.stage) return;
    const files = selected.slice(0, MAX_FILES);
    const dropped = selected.length - files.length;

    setReading(true);
    const createdIds: number[] = [];
    const failed: string[] = [];
    let first: Awaited<ReturnType<typeof readOneFile>> | null = null;

    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length, current: files[i].name });
      try {
        const r = await readOneFile(files[i], type.stage);
        createdIds.push(r.id);
        if (!first) first = r;
      } catch (e) {
        failed.push(files[i].name);
        if (e instanceof AiUnavailableError) {
          toast({ title: "エラー", description: e.message, variant: "destructive" });
          break;
        }
      }
    }

    setProgress(null);
    setReading(false);
    if (fileRef.current) fileRef.current.value = "";
    qc.invalidateQueries({ queryKey: ["/api/received-invoices"] });

    if (createdIds.length === 0) {
      toast({
        title: "読み取れませんでした",
        description: failed.length > 0 ? `${failed.join("、")}／手で入力してください。` : "",
        variant: "destructive",
      });
      return;
    }

    // 1件だけなら確認画面へ。複数なら一覧へ（上から順に確認してもらう）
    if (createdIds.length === 1 && first) {
      toast({
        title: "読み取り完了",
        description: first.amountMismatch
          ? `${first.lines}行を読み取りました。金額が${formatCurrency(first.amountDiff)}ずれています。内容を確かめてください。`
          : `${first.lines}行を読み取りました。内容を確かめてから現場に送ってください。`,
      });
      // この画面を離れて別の作業をしているときに、勝手に画面を奪わない
      if (mounted.current) navigate(`/received-invoices/${createdIds[0]}`);
      return;
    }

    const notes = [
      failed.length > 0 ? `${failed.length}件は読み取れませんでした` : "",
      dropped > 0 ? `${dropped}件は上限（${MAX_FILES}件）を超えたので取り込んでいません` : "",
    ].filter(Boolean);
    toast({
      title: `${createdIds.length}件を取り込みました`,
      description: ["1件ずつ内容を確かめてください。", ...notes].join(" "),
      variant: failed.length > 0 ? "destructive" : undefined,
    });
    if (mounted.current) navigate("/received-invoices");
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-teal-700 text-white p-2 rounded-lg">
          <ScanLine className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">スキャンする（読み込み）</h1>
          <p className="text-sm text-slate-500">書類の種類を選んでから、スキャンしたPDFか写真を選びます。</p>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
      />

      {reading && (
        <Card className="border-teal-300 bg-teal-50/40">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
            <div className="text-sm text-slate-700">
              読み取っています
              {progress && (
                <span className="text-slate-500">
                  （{progress.done + 1}/{progress.total}件目・{progress.current}）
                </span>
              )}
              <div className="text-xs text-slate-500 mt-0.5">
                1件30秒〜3分。終わるまでこのタブを閉じないでください。
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {DOC_TYPES.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              disabled={!t.ready || reading}
              onClick={() => start(t)}
              className={`text-left rounded-xl border p-4 transition-colors ${
                t.ready
                  ? "bg-white border-slate-200 hover:border-teal-400 hover:bg-teal-50/40 cursor-pointer"
                  : "bg-slate-50 border-slate-200 opacity-70 cursor-not-allowed"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${t.ready ? "bg-teal-100 text-teal-700" : "bg-slate-200 text-slate-500"}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    <span className="text-slate-400 mr-1">{t.no}</span>
                    {t.title}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{t.hint}</div>
                  {!t.ready && (
                    <div className="text-xs text-amber-700 mt-1.5">準備中（{t.pending}）</div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 取り込み枠。仕入の振り分けの「書類を取り込む」と同じ形。種類は選ぶまで空のまま */}
      <Card>
        <CardHeader className="py-3 border-b">
          <CardTitle className="text-sm font-semibold text-slate-700">書類を取り込む</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">書類の種類</span>
            {DOC_TYPES.filter((t) => t.ready).map((t) => (
              <button
                key={t.key}
                type="button"
                disabled={reading}
                onClick={() => setDropType(t)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  dropType?.key === t.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {t.no} {t.title}
              </button>
            ))}
            {dropType && <span className="text-[11px] text-slate-400">{dropType.hint}</span>}
          </div>
          <button
            type="button"
            disabled={reading}
            onClick={openDropPicker}
            onDragOver={(e) => { e.preventDefault(); if (!reading && dropType) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (reading) return;
              handleDrop(Array.from(e.dataTransfer.files ?? []));
            }}
            className={`w-full border-2 border-dashed rounded-lg py-10 text-center transition-colors disabled:opacity-60 ${
              !dropType
                ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                : dragOver
                  ? "border-primary bg-primary/5"
                  : "border-slate-200 hover:border-primary hover:bg-slate-50"
            }`}
          >
            {dropType ? (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-6 h-6 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">
                  {dropType.no} {dropType.title}のPDF・写真を選ぶ（まとめて選べます）
                </span>
                <span className="text-xs text-slate-400">
                  ここにドラッグしても取り込めます。
                  {dropType.page
                    ? `一度に${MAX_FILES}件まで（1件30秒〜3分）。読み取った分は下の「確認待ちの書類」に並びます`
                    : `一度に${MAX_FILES}件まで（1件30秒〜3分）。読み取った分は仕入の振り分けに並びます`}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-6 h-6 text-slate-300" />
                <span className="text-sm font-semibold text-slate-400">先に書類の種類を選んでください</span>
                <span className="text-xs text-slate-400">種類を選ぶと、ここにPDF・写真をドラッグして取り込めます</span>
              </div>
            )}
          </button>
        </CardContent>
      </Card>

      {/* ①②③の確認待ち。④⑤の下書きは仕入の振り分けの一覧に並ぶ */}
      <Card>
        <CardHeader className="py-3 border-b">
          <CardTitle className="text-sm font-semibold text-slate-700">
            確認待ちの書類（①②③）
            <span className={`ml-2 ${drafts.length > 0 ? "text-amber-600" : "text-slate-400"}`}>{drafts.length}件</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {drafts.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">
              確認待ちの書類はありません。④⑤（納品書・請求書）は「仕入の振り分け」に並びます。
            </div>
          ) : (
            <ul className="divide-y">
              {drafts.map((d) => {
                const t = DOC_TYPES.find((x) => x.key === d.kind);
                return (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <button
                      type="button"
                      onClick={() => navigate(`${SCAN_DRAFT_PAGE[d.kind]}?draft=${d.id}`)}
                      className="flex-1 min-w-0 text-left flex items-center gap-3"
                    >
                      <span className="text-xs text-slate-500 shrink-0 w-40 truncate">
                        {t?.no} {t?.title}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-900 truncate">
                          {d.title || <span className="text-slate-400">（読み取れませんでした）</span>}
                        </span>
                        <span className="block text-xs text-slate-400 truncate">
                          {d.fileName}・{new Date(d.createdAt).toLocaleDateString("ja-JP")}取り込み
                        </span>
                      </span>
                      <span className="text-sm tabular-nums text-slate-700 shrink-0">
                        {d.amount != null ? formatCurrency(d.amount) : ""}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-400 hover:text-destructive"
                      disabled={delDraft.isPending}
                      onClick={() => {
                        if (window.confirm(`「${d.title || d.fileName}」の下書きを削除しますか？`)) delDraft.mutate(d.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-medium text-slate-700">うまく読み取れないとき</div>
          <p className="text-xs text-slate-500">
            手書きの書類はAIが金額を読み違えるので、手で入力するほうが確実です。
            スキャナは白黒ではなくグレースケール300dpiにすると読み取りが良くなります。
          </p>
          {/* 手入力の入口は仕入の振り分けの画面にある */}
          <Button variant="outline" size="sm" onClick={() => navigate("/received-invoices")}>
            <Keyboard className="w-4 h-4 mr-1" />
            AIを使わず手で入力する
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
