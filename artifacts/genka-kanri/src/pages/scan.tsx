import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { readOneFile, AiUnavailableError, type ImportStage } from "./received-invoices/import";
import { setPendingScanFile } from "./scan-pending";
import { ScanLine, FileText, Truck, Loader2, Keyboard, Upload, CheckCircle2 } from "lucide-react";

// ─── スキャンする（読み込み）──────────────────────────────────────────────────
//
// おおつか様の依頼（2026-09-10）：書類のスキャンを起点に登録できるようにする。
// 書類の種類は①〜⑤。④下請納品書・⑤下請請求書は仕入の振り分けへ、①元請注文書・
// ②客先見積書/契約書は工事登録の画面（/scan/prime-order・/scan/client-estimate）へ、
// ③下請見積書は実行予算に入れる画面（/scan/subcontract-estimate）へ進む。

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
  const fileRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<DocType | null>(null);
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

  // 種類を選んでからファイルを選ぶ（仕入の振り分けの取り込みと同じ置き場を下に出す）。
  // 選んだ種類で段階や読み取り先の画面が決まるので、種類を選ぶまでは取り込めない。
  const pick = (t: DocType) => setPicked(t);

  const openPicker = () => {
    if (!picked) {
      toast({ title: "先に書類の種類を選んでください", variant: "destructive" });
      return;
    }
    fileRef.current?.click();
  };

  const handleDrop = (files: File[]) => {
    if (!picked) {
      toast({ title: "先に書類の種類を選んでください", description: "上の①〜⑤から選んでから、もう一度入れてください。", variant: "destructive" });
      return;
    }
    handleFiles(files);
  };

  const handleFiles = async (selected: File[]) => {
    // 確認画面が別ページにある書類（①）は、選んだファイルを持ってそのページへ移る
    if (picked?.page && selected.length > 0) {
      if (selected.length > 1) {
        toast({ title: "この書類は1件ずつ読み込みます", description: `最初の「${selected[0].name}」を読み込みます。` });
      }
      setPendingScanFile(selected[0]);
      if (fileRef.current) fileRef.current.value = "";
      navigate(picked.page);
      return;
    }
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
          const selected = picked?.key === t.key;
          return (
            <button
              key={t.key}
              type="button"
              disabled={!t.ready || reading}
              onClick={() => pick(t)}
              className={`relative text-left rounded-xl border p-4 transition-colors ${
                !t.ready
                  ? "bg-slate-50 border-slate-200 opacity-70 cursor-not-allowed"
                  : selected
                    ? "bg-teal-50 border-teal-500 ring-2 ring-teal-500/30 cursor-pointer"
                    : "bg-white border-slate-200 hover:border-teal-400 hover:bg-teal-50/40 cursor-pointer"
              }`}
            >
              {selected && <CheckCircle2 className="absolute top-3 right-3 w-5 h-5 text-teal-600" />}
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

      {/* 取り込みの置き場。種類を選ぶまでは押しても入れても取り込まない */}
      <button
        type="button"
        disabled={reading}
        onClick={openPicker}
        onDragOver={(e) => { e.preventDefault(); if (!reading && picked) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (reading) return;
          handleDrop(Array.from(e.dataTransfer.files ?? []));
        }}
        className={`w-full border-2 border-dashed rounded-xl py-10 text-center transition-colors disabled:opacity-60 ${
          !picked
            ? "border-slate-200 bg-slate-50 cursor-not-allowed"
            : dragOver
              ? "border-teal-500 bg-teal-50"
              : "border-teal-300 bg-white hover:border-teal-500 hover:bg-teal-50/40"
        }`}
      >
        {picked ? (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-6 h-6 text-teal-600" />
            <span className="text-sm font-semibold text-slate-700">
              {picked.no} {picked.title} のPDF・写真を選ぶ
              {picked.page ? "" : "（まとめて選べます）"}
            </span>
            <span className="text-xs text-slate-400">
              ここにドラッグしても取り込めます。
              {picked.page ? "この書類は1件ずつ読み込みます" : `一度に${MAX_FILES}件まで（1件30秒〜3分）`}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-6 h-6 text-slate-300" />
            <span className="text-sm font-semibold text-slate-400">先に上で書類の種類を選んでください</span>
            <span className="text-xs text-slate-400">種類を選ぶと、ここにPDF・写真を入れられるようになります</span>
          </div>
        )}
      </button>

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
