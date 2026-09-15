import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { readOneFile, AiUnavailableError, type ImportStage } from "./received-invoices/import";
import { ScanLine, FileText, Truck, Loader2, Keyboard } from "lucide-react";

// ─── スキャンする（読み込み）──────────────────────────────────────────────────
//
// おおつか様の依頼（2026-09-10）：書類のスキャンを起点に登録できるようにする。
// 書類の種類は①〜⑤。うち④下請納品書・⑤下請請求書は原価の入口が既にあるので先に作った。
// ①元請注文書・②客先見積書/契約書・③下請見積書は、登録先と金額の扱いが未確定のため、
// ここでは「準備中」と出して押せないようにしてある（押せると期待させてしまうため）。

const MAX_FILES = 10;

type DocType = {
  key: string;
  no: string;
  title: string;
  hint: string;
  stage?: ImportStage;
  icon: typeof FileText;
  ready: boolean;
  pending?: string;
};

const DOC_TYPES: DocType[] = [
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
    key: "subcontract-delivery",
    no: "④",
    title: "下請からの納品書",
    hint: "仮原価として記録します（請求書が届くまで原価には入れません）",
    stage: "provisional",
    icon: Truck,
    ready: true,
  },
  {
    key: "subcontract-estimate",
    no: "③",
    title: "下請の見積書",
    hint: "実行予算のもとになる書類",
    icon: FileText,
    ready: false,
    pending: "登録先を相談中",
  },
  {
    key: "client-estimate",
    no: "②",
    title: "客先へ出した見積書・契約書",
    hint: "工事の登録に使う書類",
    icon: FileText,
    ready: false,
    pending: "仕様を相談中",
  },
  {
    key: "prime-order",
    no: "①",
    title: "元請からの注文書",
    hint: "工事の登録に使う書類",
    icon: FileText,
    ready: false,
    pending: "仕様を相談中",
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
  const fileRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<DocType | null>(null);
  const [reading, setReading] = useState(false);
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

  const start = (t: DocType) => {
    setPicked(t);
    // 種類を選んでからファイルを選ぶ。選んだ種類で段階が決まる
    setTimeout(() => fileRef.current?.click(), 0);
  };

  const handleFiles = async (selected: File[]) => {
    if (selected.length === 0 || !picked?.stage) return;
    const files = selected.slice(0, MAX_FILES);
    const dropped = selected.length - files.length;

    setReading(true);
    const createdIds: number[] = [];
    const failed: string[] = [];
    let first: Awaited<ReturnType<typeof readOneFile>> | null = null;

    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length, current: files[i].name });
      try {
        const r = await readOneFile(files[i], picked.stage);
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
