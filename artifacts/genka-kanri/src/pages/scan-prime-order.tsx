import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Keyboard, Loader2, AlertTriangle, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MasterSelect } from "@/components/master-select";
import { useStaffMembers } from "@/hooks/use-staff-members";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { takePendingScanFile } from "./scan-pending";

// ─── ①元請からの注文書をスキャンして、工事を仮登録する ─────────────────────────
//
// 事務が注文書を読み込み、AIが読んだ工事名・請負金額・工期を確かめて保存する。
// 部門は現場担当者が決める（追加依頼4）ので、ここでは聞かない。保存すると仮登録になり、
// 担当者が「自分の現場」か工事詳細の「本登録する」で部門を選んで正式な工事にする。
// 先に③下請見積書などで仮登録してある工事があれば、作り直さずにそこへ入れる。

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const NEW_PROJECT = "__new__";
const MANUAL_CLIENT = "__manual__";

interface ClientRow { id: number; clientCode: string; name: string; kana?: string | null }
interface ProvisionalRow { id: number; projectCode: string; name: string; siteManager: string | null }

type Draft = {
  projectName?: string;
  clientName?: string;
  location?: string;
  orderNumber?: string;
  orderDate?: string;
  startDate?: string;
  endDate?: string;
  taxExcludedAmount?: number;
  taxAmount?: number;
  taxIncludedAmount?: number;
  handwritten?: boolean;
};

const amountStr = (n: number | undefined) => (n && n > 0 ? String(n) : "");
// 名前の比較用（空白・株式会社などを外す）。仮登録の工事の候補を出すのに使う
const strip = (s: string) => s.replace(/[\s　]|株式会社|（株）|\(株\)|様邸|邸/g, "");

export default function ScanPrimeOrder() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: staffMembers = [] } = useStaffMembers();
  const staffNames = staffMembers.filter((s) => s.isActive !== false).map((s) => s.name);

  const { data: clientsData } = useQuery<{ items: ClientRow[] }>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/clients`);
      if (!r.ok) return { items: [] };
      return r.json();
    },
    staleTime: 60_000,
  });
  const clients = clientsData?.items ?? [];

  const { data: provisionalData } = useQuery<{ items: ProvisionalRow[] }>({
    queryKey: ["/api/projects", { status: "provisional" }],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/projects?status=provisional&limit=2000`);
      if (!r.ok) return { items: [] };
      return r.json();
    },
  });
  const provisionals = provisionalData?.items ?? [];

  const [step, setStep] = useState<"pick" | "reading" | "form">("pick");
  const [file, setFile] = useState<{ base64: string; mediaType: string; url: string; name: string } | null>(null);
  const [aiRead, setAiRead] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [location, setLocation] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [taxExcluded, setTaxExcluded] = useState("");
  const [tax, setTax] = useState("");
  const [contract, setContract] = useState("");
  const [siteManager, setSiteManager] = useState("");
  const [target, setTarget] = useState(NEW_PROJECT);

  // 画面を離れたらプレビュー用のURLを捨てる
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  // 読み取った工事名に近い仮登録の工事を探す（③で先に作ってあるケース）
  const suggested = useMemo(() => {
    const n = strip(name);
    if (!n) return null;
    return provisionals.find((p) => {
      const h = strip(p.name);
      return h.length > 0 && (h.includes(n) || n.includes(h));
    }) ?? null;
  }, [name, provisionals]);

  const applyDraft = (d: Draft, clientMatch?: { clientCode: string; name: string }) => {
    setName(d.projectName ?? "");
    if (clientMatch) {
      setClientName(clientMatch.name);
      setClientCode(clientMatch.clientCode);
    } else {
      setClientName(d.clientName ?? "");
      setClientCode("");
    }
    setLocation(d.location ?? "");
    setOrderNumber(d.orderNumber ?? "");
    setOrderDate(d.orderDate ?? "");
    setStartDate(d.startDate ?? "");
    setEndDate(d.endDate ?? "");
    setTaxExcluded(amountStr(d.taxExcludedAmount));
    setTax(amountStr(d.taxAmount));
    setContract(amountStr(d.taxIncludedAmount));
  };

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
      const r = await fetch(`${BASE}/api/ai-extract/prime-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mediaType }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message ?? "読み取りに失敗しました");
      const match = (body.clientMatches ?? [])[0];
      applyDraft(body.draft as Draft, match);
      setAiRead(true);
      const w: string[] = [];
      if (body.amountMismatch) w.push("税抜＋消費税が税込の額と合いません。金額を確かめてください。");
      if (body.draft?.handwritten) w.push("手書きの部分があります。金額と工期を特に確かめてください。");
      if (!match && body.draft?.clientName) w.push(`注文者「${body.draft.clientName}」が得意先マスタに見つかりません。`);
      setWarnings(w);
    } catch (e) {
      // 読めなくても原本は残して、手で入れてもらう
      setAiRead(false);
      setWarnings([`${e instanceof Error ? e.message : "読み取りに失敗しました"}　内容は手で入力してください。`]);
    }
    setStep("form");
  };

  // スキャンする画面でファイルを選んでから来たときは、すぐ読み取りを始める。
  // 直接開いた・再読み込みしたときは、この画面でファイルを選んでもらう
  useEffect(() => {
    const f = takePendingScanFile();
    if (f) handleFile(f);
  }, []);

  // 仮登録の候補が見つかったら、最初の1回だけそちらを選んでおく（人が選び直せる）
  const suggestedOnce = useRef(false);
  useEffect(() => {
    if (step === "form" && suggested && !suggestedOnce.current) {
      suggestedOnce.current = true;
      setTarget(String(suggested.id));
      if (!siteManager && suggested.siteManager) setSiteManager(suggested.siteManager);
    }
  }, [step, suggested]);

  const onTaxExcludedChange = (v: string) => {
    setTaxExcluded(v);
    const ex = parseFloat(v);
    if (Number.isFinite(ex) && ex > 0) {
      const t = Math.floor(ex * 0.1);
      setTax(String(t));
      setContract(String(ex + t));
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "工事名を入力してください", variant: "destructive" });
      return;
    }
    const amount = parseFloat(contract);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "請負金額（税込）を入力してください", variant: "destructive" });
      return;
    }
    if (!siteManager) {
      toast({ title: "担当者を選んでください", description: "担当者が部門を選んで本登録します。", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/projects/from-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetProjectId: target === NEW_PROJECT ? null : Number(target),
          name: name.trim(),
          clientName: clientName.trim(),
          clientCode: clientCode || null,
          location: location.trim(),
          orderNumber: orderNumber.trim() || null,
          orderDate: orderDate || null,
          startDate: startDate || null,
          endDate: endDate || null,
          taxExcludedAmount: taxExcluded ? parseFloat(taxExcluded) : null,
          taxAmount: tax ? parseFloat(tax) : null,
          contractAmount: amount,
          siteManager,
          fileBase64: file?.base64,
          mediaType: file?.mediaType,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message ?? "保存に失敗しました");
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("/projects") });
      toast({
        title: "工事を仮登録しました",
        description: `${siteManager}さんが部門を選ぶと本登録になります。`,
      });
      navigate(`/projects/${body.id}?tab=basic`);
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
          <span className="text-slate-400 mr-1">①</span>元請からの注文書
        </h1>
        <p className="text-sm text-slate-500">
          注文書から工事を仮登録します。部門は担当者が決めて本登録します。実行予算は空のまま作られます。
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
              注文書のPDF・写真を選ぶ
            </Button>
            <Button variant="outline" onClick={() => { setAiRead(false); setWarnings([]); setStep("form"); }}>
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
          {file && (
            <Card className="overflow-hidden">
              <CardContent className="p-0 h-[70vh] bg-slate-100">
                {file.mediaType === "application/pdf" ? (
                  <iframe src={file.url} title={file.name} className="w-full h-full" />
                ) : (
                  <img src={file.url} alt={file.name} className="w-full h-full object-contain" />
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-4">
              {aiRead && (
                <p className="text-xs text-slate-500 bg-slate-50 rounded px-2.5 py-2">
                  AIが読み取った内容です。原本と見比べて、違うところを直してから保存してください。
                </p>
              )}
              {warnings.map((w) => (
                <div key={w} className="flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {w}
                </div>
              ))}

              <div>
                <Label>登録先</Label>
                <Select value={target} onValueChange={(v) => {
                  setTarget(v);
                  const p = provisionals.find((x) => String(x.id) === v);
                  if (p?.siteManager && !siteManager) setSiteManager(p.siteManager);
                }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_PROJECT}>新しい工事として仮登録する</SelectItem>
                    {provisionals.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        仮登録済みの工事に入れる：{p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {suggested && target === String(suggested.id) && (
                  <p className="text-xs text-teal-700 mt-1">
                    工事名が近い仮登録の工事があったので選んでいます。別の工事なら「新しい工事として仮登録する」に変えてください。
                  </p>
                )}
              </div>

              <div>
                <Label>工事名 <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
              </div>

              <div>
                <Label>注文者（得意先）</Label>
                <div className="flex gap-2 mt-1">
                  <Select
                    value={clients.some((c) => c.clientCode === clientCode) ? clientCode : MANUAL_CLIENT}
                    onValueChange={(v) => {
                      if (v === MANUAL_CLIENT) { setClientCode(""); return; }
                      const c = clients.find((x) => x.clientCode === v);
                      if (c) { setClientCode(c.clientCode); setClientName(c.name); }
                    }}
                  >
                    <SelectTrigger className="flex-1 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent searchPlaceholder="得意先名で検索">
                      <SelectItem value={MANUAL_CLIENT}>— 直接入力 —</SelectItem>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.clientCode} data-search-text={c.kana ?? ""}>
                          <span className="font-mono text-slate-500 mr-1 text-xs">{c.clientCode}</span>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={clientName} onChange={(e) => setClientName(e.target.value)} className="flex-1 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>工事場所</Label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>注文番号</Label>
                  <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>注文日</Label>
                  <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>着工日</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>竣工予定日</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>税抜</Label>
                  <NumberInput value={taxExcluded} onChange={onTaxExcludedChange} className="mt-1 text-right" placeholder="0" />
                </div>
                <div>
                  <Label>消費税</Label>
                  <NumberInput value={tax} onChange={setTax} className="mt-1 text-right" placeholder="0" />
                </div>
                <div>
                  <Label>請負金額（税込） <span className="text-destructive">*</span></Label>
                  <NumberInput value={contract} onChange={setContract} className="mt-1 text-right" placeholder="0" />
                </div>
              </div>

              <div>
                <Label>担当者 <span className="text-destructive">*</span></Label>
                <MasterSelect
                  className="mt-1 text-sm"
                  value={siteManager}
                  onChange={setSiteManager}
                  options={staffNames}
                  placeholder="担当者を選択"
                />
                <p className="text-xs text-slate-400 mt-1">
                  この工事は担当者の「自分の現場」に出ます。担当者が部門を選ぶと本登録になります。
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => navigate("/scan")} disabled={saving}>やめる</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  仮登録する
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
