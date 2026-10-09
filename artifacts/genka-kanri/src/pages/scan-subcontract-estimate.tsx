import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Keyboard, Loader2, AlertTriangle, Save, Plus, Trash2, Combine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProvisionalProjectDialog } from "@/components/provisional-project-dialog";
import { useVendors } from "@/hooks/use-vendors";
import { useWorkTypes } from "@/hooks/use-work-types";
import { useToast } from "@/hooks/use-toast";
import { cn, formatCurrency } from "@/lib/utils";
import { takePendingScanFile } from "./scan-pending";

// ─── ③下請の見積書をスキャンして、実行予算に入れる ─────────────────────────────
//
// AIが読んだ仕入先・表紙の行（名称・金額）を確かめ、行ごとに工種を選んで実行予算に入れる。
// 見積書は印字の合計と実際に決まった額が違うことが多い（手書きの「改メ」・Net価格）。
// 行は最初は明細（印字）どおりに入る。決定額に合わせたいときだけ、ボタンで各行へ同じ割合で割り振る
// （アイさん判断 2026-10-09：割り振りは最初からやらず、任意の操作にする）。割り振った額は直せる。
// 工事が決まる前に届くことがあるので、工事が無ければその場で仮登録できる（追加依頼2）。

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const NEW_PROVISIONAL = "__new_provisional__";

interface ProjectRow { id: number; projectCode: string; name: string; status: string; siteManager: string | null }
interface VendorItem { id: number; name: string; kana?: string | null }
interface WorkTypeItem { id: number; code: string; name: string }

type Line = { key: number; name: string; printed: number; workTypeId: string; amount: string };

let lineKey = 0;
const newLine = (name: string, printed: number, workTypeId = ""): Line =>
  ({ key: ++lineKey, name, printed, workTypeId, amount: String(printed) });

// 名前の比較用。工事・工種の候補を出すのに使う
const strip = (s: string) => s.replace(/[\s　]|株式会社|（株）|\(株\)|工事|様邸|邸/g, "");

/**
 * 決定額を各行へ印字の額と同じ割合で割り振る。円未満の端数は一番大きい行で吸収して、合計を決定額にそろえる。
 * 印字の合計が0なら割り振れないので、決定額を先頭の行に入れる。
 */
function allocate(lines: Line[], decided: number): Line[] {
  const printedSum = lines.reduce((s, l) => s + l.printed, 0);
  if (lines.length === 0) return lines;
  if (printedSum === 0) return lines.map((l, i) => ({ ...l, amount: String(i === 0 ? decided : 0) }));
  const amounts = lines.map((l) => Math.round((decided * l.printed) / printedSum));
  const diff = decided - amounts.reduce((s, a) => s + a, 0);
  let big = 0;
  lines.forEach((l, i) => { if (Math.abs(l.printed) > Math.abs(lines[big].printed)) big = i; });
  amounts[big] += diff;
  return lines.map((l, i) => ({ ...l, amount: String(amounts[i]) }));
}

export default function ScanSubcontractEstimate() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: vendors = [] } = useVendors<VendorItem>();
  const { data: workTypes = [] } = useWorkTypes<WorkTypeItem>();

  const { data: projectsData } = useQuery<{ items: ProjectRow[] }>({
    queryKey: ["/api/projects", "all"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/projects?limit=2000`);
      if (!r.ok) return { items: [] };
      return r.json();
    },
  });
  // 完工した工事には見積書は来ないので出さない（選択肢が増えすぎないように）
  const projects = (projectsData?.items ?? []).filter((p) => p.status !== "completed");

  const [step, setStep] = useState<"pick" | "reading" | "form">("pick");
  const [file, setFile] = useState<{ base64: string; mediaType: string; url: string; name: string } | null>(null);
  const [aiRead, setAiRead] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [decidedNote, setDecidedNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [provisionalOpen, setProvisionalOpen] = useState(false);

  const [readProjectName, setReadProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [estimateNumber, setEstimateNumber] = useState("");
  const [estimateDate, setEstimateDate] = useState("");
  const [printedTotal, setPrintedTotal] = useState(0);
  const [decided, setDecided] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  // 工種の候補：行の名称に工種名（「工事」を除く）が含まれていれば選んでおく。
  // 読み取りはファイルを受け取った直後に始まり、工種の一覧より先に終わることもあるので、
  // 最新の一覧を ref から引く（関数が作られた時点の空の一覧を見ないように）
  const workTypesRef = useRef(workTypes);
  workTypesRef.current = workTypes;
  const guessWorkType = (name: string) => {
    const n = strip(name);
    const hit = workTypesRef.current.find((w) => {
      const h = strip(w.name);
      return h.length > 0 && (n.includes(h) || h.includes(n));
    });
    return hit ? String(hit.id) : "";
  };

  const suggestedProject = useMemo(() => {
    const n = strip(readProjectName);
    if (!n) return null;
    return projects.find((p) => {
      const h = strip(p.name);
      return h.length > 0 && (h.includes(n) || n.includes(h));
    }) ?? null;
  }, [readProjectName, projects]);

  // 工事名が近い工事があれば、最初の1回だけ選んでおく（人が選び直せる）
  const suggestedOnce = useRef(false);
  useEffect(() => {
    if (step === "form" && suggestedProject && !suggestedOnce.current) {
      suggestedOnce.current = true;
      setProjectId(String(suggestedProject.id));
    }
  }, [step, suggestedProject]);

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    const base64 = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
      fr.onerror = reject;
      fr.readAsDataURL(f);
    });
    const mediaType = f.type || "application/pdf";
    setFile({ base64, mediaType, url: URL.createObjectURL(f), name: f.name });
    setStep("reading");
    try {
      const r = await fetch(`${BASE}/api/ai-extract/subcontract-estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mediaType }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message ?? "読み取りに失敗しました");
      const d = body.draft ?? {};
      setReadProjectName(d.projectName ?? "");
      setEstimateNumber(d.estimateNumber ?? "");
      setEstimateDate(d.estimateDate ?? "");
      const match = (body.vendorMatches ?? [])[0];
      setVendorId(match ? String(match.id) : "");
      const read: Line[] = (d.lines ?? []).map((l: { name: string; amount: number }) =>
        newLine(l.name ?? "", Number(l.amount) || 0, guessWorkType(l.name ?? "")));
      const printed = Number(d.subtotal) || read.reduce((s, l) => s + l.printed, 0);
      setPrintedTotal(printed);
      // 決まった額が書かれていればそれを、無ければ印字の合計を決定額の初期値にする
      const dec = Number(d.decidedAmount) || printed;
      setDecided(String(dec));
      setLines(read);
      setDecidedNote(Number(d.decidedAmount) ? (d.decidedNote || "書き込み") : "");
      setAiRead(true);
      const w: string[] = [];
      if (body.linesMismatch) {
        w.push(`表紙の行の合計（${formatCurrency(body.linesSum)}）が印字の合計と合いません。行の読み落としや、合計に入らない行が無いか確かめてください。`);
      }
      if (!match && d.vendorName) w.push(`仕入先「${d.vendorName}」が仕入先マスタに見つかりません。`);
      setWarnings(w);
    } catch (e) {
      setAiRead(false);
      setLines([newLine("", 0)]);
      setWarnings([`${e instanceof Error ? e.message : "読み取りに失敗しました"}　内容は手で入力してください。`]);
    }
    setStep("form");
  };

  useEffect(() => {
    const f = takePendingScanFile();
    if (f) handleFile(f);
  }, []);

  // 二重取り込みの警告：選んだ工事に、同じ仕入先・同じ印字の合計の見積書がもう入っていないか
  const { data: existingData } = useQuery<{ items: { vendorId: number | null; printedTotal: number; createdAt: string }[] }>({
    queryKey: ["/api/subcontract-estimates", Number(projectId)],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/subcontract-estimates?projectId=${projectId}`);
      if (!r.ok) return { items: [] };
      return r.json();
    },
    enabled: !!projectId,
  });
  const duplicate = (existingData?.items ?? []).find((e) =>
    vendorId !== "" && e.vendorId === Number(vendorId) && Math.round(e.printedTotal) === Math.round(printedTotal));

  const decidedNum = parseFloat(decided) || 0;
  const linesTotal = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const totalsDiffer = lines.length > 0 && Math.round(linesTotal) !== Math.round(decidedNum);

  const onDecidedChange = (v: string) => setDecided(v);
  const fitToDecided = () => setLines((ls) => allocate(ls, decidedNum));
  const resetToPrinted = () => setLines((ls) => ls.map((l) => ({ ...l, amount: String(l.printed) })));
  const isPrinted = lines.every((l) => Math.round(parseFloat(l.amount) || 0) === Math.round(l.printed));
  const printedSum = lines.reduce((s, l) => s + l.printed, 0);
  const ratio = printedSum !== 0 ? (decidedNum / printedSum) * 100 : null;
  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const mergeLines = () => {
    // 工種が1つの見積書（品物ごと・場所ごとに行が並ぶもの）は1行にまとめる
    const first = lines[0];
    // 印字の額も今の金額も、そのまま足し合わせる（まとめただけで額が変わらないように）
    const printed = lines.reduce((s, l) => s + l.printed, 0);
    setLines([{ ...newLine(first?.name ?? "", printed, first?.workTypeId ?? ""), amount: String(linesTotal) }]);
  };

  const handleSave = async () => {
    if (!projectId) {
      toast({ title: "工事を選んでください", description: "まだ無ければ「新しい工事を仮登録」から作れます。", variant: "destructive" });
      return;
    }
    if (!vendorId) {
      toast({ title: "仕入先を選んでください", variant: "destructive" });
      return;
    }
    if (lines.length === 0) {
      toast({ title: "実行予算に入れる行がありません", variant: "destructive" });
      return;
    }
    if (lines.some((l) => !l.workTypeId)) {
      toast({ title: "すべての行で工種を選んでください", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/subcontract-estimates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: Number(projectId),
          vendorId: Number(vendorId),
          estimateNumber,
          estimateDate: estimateDate || null,
          printedTotal,
          decidedTotal: decidedNum,
          lines: lines.map((l) => {
            const w = workTypes.find((x) => String(x.id) === l.workTypeId);
            return { workTypeCode: w?.code, workTypeName: w?.name, amount: parseFloat(l.amount) || 0 };
          }),
          fileBase64: file?.base64,
          mediaType: file?.mediaType,
          // 警告を見たうえで押したときだけ、重複でも入れる
          allowDuplicate: !!duplicate,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 409 && body.duplicate) {
        // 画面を開いている間に、別の人が同じ見積書を入れていた
        qc.invalidateQueries({ queryKey: ["/api/subcontract-estimates", Number(projectId)] });
        throw new Error("この見積書はもう実行予算に入っています。内容を確かめてから、もう一度押してください。");
      }
      if (!r.ok) throw new Error(body.message ?? "保存に失敗しました");
      qc.invalidateQueries({ predicate: (q) => /\/projects|\/subcontract-estimates/.test(String(q.queryKey[0] ?? "")) });
      toast({ title: "実行予算に入れました", description: `${body.budgetItemCount}行を追加しました。` });
      navigate(`/projects/${body.projectId}/budgets`);
    } catch (e) {
      toast({ title: "保存できませんでした", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/scan">
          <button className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> スキャンする へ戻る
          </button>
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          <span className="text-slate-400 mr-1">③</span>下請の見積書
        </h1>
        <p className="text-sm text-slate-500">
          見積書の金額を実行予算に入れます。工事がまだ無ければ、その場で仮登録できます。
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {step === "pick" && (
        <Card>
          <CardContent className="p-6 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Button onClick={() => fileRef.current?.click()}>
              <FileText className="w-4 h-4 mr-2" />
              見積書のPDF・写真を選ぶ
            </Button>
            <Button variant="outline" onClick={() => { setAiRead(false); setWarnings([]); setLines([newLine("", 0)]); setStep("form"); }}>
              <Keyboard className="w-4 h-4 mr-2" />
              AIを使わず手で入力する
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "reading" && (
        <Card className="border-teal-300 bg-teal-50/40">
          <CardContent className="p-4 flex items-center gap-3 text-sm text-slate-700">
            <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
            読み取っています（30秒〜1分ほど）。このタブを閉じないでください。
          </CardContent>
        </Card>
      )}

      {step === "form" && (
        <div className={cn("grid gap-4", file ? "lg:grid-cols-2" : "")}>
          {/* 右の入力欄の高さに合わせて伸びるので、原本も枠いっぱいに広げる */}
          {file && (
            <Card className="overflow-hidden flex flex-col">
              <CardContent className="p-0 flex-1 min-h-[70vh] relative bg-slate-100">
                {file.mediaType === "application/pdf" ? (
                  <iframe src={file.url} title={file.name} className="absolute inset-0 w-full h-full" />
                ) : (
                  <img src={file.url} alt={file.name} className="absolute inset-0 w-full h-full object-contain" />
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-4">
              {aiRead && (
                <p className="text-xs text-slate-500 bg-slate-50 rounded px-2.5 py-2">
                  AIが読み取った内容です。原本と見比べて、違うところを直してから保存してください。金額はすべて税抜です。
                </p>
              )}
              {warnings.map((w) => (
                <div key={w} className="flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {w}
                </div>
              ))}

              <div>
                <Label>工事 <span className="text-destructive">*</span></Label>
                <Select value={projectId} onValueChange={(v) => {
                  if (v === NEW_PROVISIONAL) { setProvisionalOpen(true); return; }
                  setProjectId(v);
                }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="工事を選択" /></SelectTrigger>
                  <SelectContent searchable searchPlaceholder="工事名・工事番号で検索">
                    <SelectItem value={NEW_PROVISIONAL} className="text-primary font-medium">＋ 新しい工事を仮登録</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        <span className="font-mono text-xs text-slate-400 mr-1.5">{p.projectCode}</span>
                        {p.name}
                        {p.status === "provisional" && <span className="ml-1.5 text-[11px] text-amber-700">（仮登録）</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {readProjectName && (
                  <p className="text-xs text-slate-500 mt-1">
                    見積書の工事名：{readProjectName}
                    {suggestedProject && projectId === String(suggestedProject.id) && "（名前が近い工事を選んでいます）"}
                  </p>
                )}
              </div>

              <div>
                <Label>仕入先 <span className="text-destructive">*</span></Label>
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="仕入先を選択" /></SelectTrigger>
                  <SelectContent searchPlaceholder="仕入先名で検索">
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={String(v.id)} data-search-text={v.kana ?? ""}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>見積番号</Label>
                  <Input value={estimateNumber} onChange={(e) => setEstimateNumber(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>見積日</Label>
                  <Input type="date" value={estimateDate} onChange={(e) => setEstimateDate(e.target.value)} className="mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>印字の合計</Label>
                  <div className="mt-1 h-9 px-3 flex items-center justify-end rounded-md border bg-slate-50 text-sm tabular-nums">
                    {formatCurrency(printedTotal)}
                  </div>
                </div>
                <div>
                  <Label>決定額 <span className="text-destructive">*</span></Label>
                  <NumberInput value={decided} onChange={onDecidedChange} className="mt-1 text-right" placeholder="0" />
                </div>
              </div>
              {decidedNote ? (
                <p className="text-xs text-teal-700 -mt-2">
                  決定額は「{decidedNote}」から読みました。合っているか必ず確かめてください。
                </p>
              ) : (
                <p className="text-xs text-slate-500 -mt-2">
                  値引きなどで決まった額が違うときは、決定額を直してください。
                </p>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>実行予算に入れる行</Label>
                  {lines.length > 1 && (
                    <button type="button" onClick={mergeLines} className="text-xs text-primary hover:underline flex items-center gap-1">
                      <Combine className="w-3.5 h-3.5" /> 1行にまとめる
                    </button>
                  )}
                </div>
                {lines.map((l) => (
                  <div key={l.key} className="rounded-md border border-slate-200 p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Input
                        value={l.name}
                        onChange={(e) => updateLine(l.key, { name: e.target.value })}
                        placeholder="名称（見積書の行）"
                        className="h-8 text-sm flex-1"
                      />
                      <span className="text-xs text-slate-400 tabular-nums shrink-0">印字 {formatCurrency(l.printed)}</span>
                      <button
                        type="button"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        className="text-slate-400 hover:text-red-600"
                        aria-label="この行を消す"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={l.workTypeId} onValueChange={(v) => updateLine(l.key, { workTypeId: v })}>
                        <SelectTrigger className={cn("h-8 text-sm", !l.workTypeId && "border-amber-400 text-amber-700")}>
                          <SelectValue placeholder="工種を選択" />
                        </SelectTrigger>
                        <SelectContent searchPlaceholder="工種名で検索">
                          {workTypes.map((w) => (
                            <SelectItem key={w.id} value={String(w.id)}>
                              <span className="font-mono text-xs text-slate-400 mr-1.5">{w.code}</span>{w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <NumberInput
                        value={l.amount}
                        onChange={(v) => updateLine(l.key, { amount: v })}
                        className="h-8 text-right text-sm"
                        placeholder="0"
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setLines((ls) => [...ls, newLine("", 0)])}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> 行を足す
                </button>
                <div className={cn("text-xs text-right tabular-nums", totalsDiffer ? "text-amber-700" : "text-slate-500")}>
                  行の合計 {formatCurrency(linesTotal)}
                  {totalsDiffer && `（決定額と ${formatCurrency(linesTotal - decidedNum)} ずれています）`}
                </div>
                {/* 決定額に合わせるのは任意。押したときだけ割り振る */}
                {totalsDiffer && printedSum !== 0 && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-900 flex flex-wrap items-center gap-2">
                    <span className="flex-1 min-w-[12rem]">
                      行は明細どおりの金額です。決定額に合わせるなら、各行を印字の額の
                      {ratio != null ? ` ${ratio.toFixed(1)}%` : "同じ割合"}にします。
                    </span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={fitToDecided}>
                      決定額に合わせて割り振る
                    </Button>
                  </div>
                )}
                {!isPrinted && (
                  <div className="text-right">
                    <button type="button" onClick={resetToPrinted} className="text-xs text-slate-500 hover:underline">
                      明細どおりの金額に戻す
                    </button>
                  </div>
                )}
              </div>

              {duplicate && (
                <div className="flex gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2.5 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    この工事には、同じ仕入先・同じ金額の見積書がもう入っています
                    （{new Date(duplicate.createdAt).toLocaleDateString("ja-JP")}）。
                    同じ見積書をもう一度入れると、実行予算が2倍になります。別の見積書のときだけ入れてください。
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => navigate("/scan")} disabled={saving}>やめる</Button>
                <Button onClick={handleSave} disabled={saving} variant={duplicate ? "destructive" : "default"}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  {duplicate ? "別の見積書なので入れる" : "実行予算に入れる"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <ProvisionalProjectDialog
        open={provisionalOpen}
        onClose={() => setProvisionalOpen(false)}
        defaultName={readProjectName}
        onCreated={(p) => setProjectId(String(p.id))}
      />
    </div>
  );
}
