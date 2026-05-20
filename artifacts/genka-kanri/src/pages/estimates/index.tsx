import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Copy, Trash2, Search, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Estimate {
  id: number;
  estimateNumber: string;
  projectId: number | null;
  projectName: string | null;
  projectCode: string | null;
  estimateDate: string;
  clientName: string;
  subject: string;
  taxIncludedAmount: number;
  status: "draft" | "submitted" | "approved" | "lost";
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "作成中", color: "bg-slate-100 text-slate-600 border-slate-200" },
  submitted: { label: "提出済", color: "bg-blue-100 text-blue-700 border-blue-200" },
  approved: { label: "承認済", color: "bg-green-100 text-green-700 border-green-200" },
  lost: { label: "失注", color: "bg-red-100 text-red-600 border-red-200" },
};

async function fetchEstimates(status: string): Promise<{ items: Estimate[] }> {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  const res = await fetch(`${BASE}/api/estimates?${params}`);
  if (!res.ok) throw new Error("fetch error");
  return res.json();
}

async function duplicateEstimate(id: number): Promise<Estimate> {
  const res = await fetch(`${BASE}/api/estimates/${id}/duplicate`, { method: "POST" });
  if (!res.ok) throw new Error("duplicate error");
  return res.json();
}

async function deleteEstimate(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/estimates/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("delete error");
}

export default function EstimateList() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["estimates", statusFilter],
    queryFn: () => fetchEstimates(statusFilter),
  });

  const dupMut = useMutation({
    mutationFn: duplicateEstimate,
    onSuccess: (est) => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast({ title: "複写しました", description: `${est.estimateNumber} を作成しました。` });
    },
    onError: () => toast({ title: "エラー", variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: deleteEstimate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast({ title: "削除しました" });
    },
    onError: () => toast({ title: "エラー", variant: "destructive" }),
  });

  const items = (data?.items ?? []).filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.estimateNumber.toLowerCase().includes(q) ||
      e.clientName.toLowerCase().includes(q) ||
      e.subject.toLowerCase().includes(q) ||
      (e.projectName ?? "").toLowerCase().includes(q)
    );
  });

  const fmt = (n: number) => `¥${n.toLocaleString()}`;
  const fmtDate = (d: string) => {
    if (!d) return "—";
    const [y, m, day] = d.split("-");
    return `${y}/${m}/${day}`;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-6 h-6 text-orange-500" />
            見積書
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">工事見積書の作成・管理を行います。</p>
        </div>
        <Link href="/estimates/new">
          <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
            <Plus className="w-4 h-4" />
            新規作成
          </Button>
        </Link>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Object.entries(STATUS_LABELS).map(([key, { label, color }]) => {
          const count = (data?.items ?? []).filter((e) => e.status === key).length;
          const sum = (data?.items ?? []).filter((e) => e.status === key).reduce((s, e) => s + e.taxIncludedAmount, 0);
          return (
            <Card
              key={key}
              className={`cursor-pointer transition-colors hover:shadow-md ${statusFilter === key ? "ring-2 ring-orange-400" : ""}`}
              onClick={() => setStatusFilter(statusFilter === key ? "all" : key)}
            >
              <CardContent className="p-4">
                <div className={`text-xs font-semibold px-2 py-0.5 rounded-full border inline-block mb-2 ${color}`}>{label}</div>
                <div className="text-xl font-bold text-slate-800">{count}<span className="text-sm font-normal text-slate-500 ml-1">件</span></div>
                <div className="text-xs text-slate-500 mt-0.5">{fmt(sum)}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* フィルター & テーブル */}
      <Card>
        <CardHeader className="border-b py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2 flex-wrap">
              {[
                { value: "all", label: "すべて" },
                { value: "draft", label: "作成中" },
                { value: "submitted", label: "提出済" },
                { value: "approved", label: "承認済" },
                { value: "lost", label: "失注" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    statusFilter === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input
                  className="h-8 pl-8 text-xs w-[200px]"
                  placeholder="番号・得意先・件名…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs text-slate-500">
                <th className="text-left px-4 py-2.5">見積番号</th>
                <th className="text-left px-4 py-2.5">工事名</th>
                <th className="text-left px-4 py-2.5">得意先</th>
                <th className="text-left px-4 py-2.5">見積日</th>
                <th className="text-right px-4 py-2.5">見積金額（税込）</th>
                <th className="text-center px-4 py-2.5">ステータス</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400">読み込み中…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400">見積書がありません</td></tr>
              ) : (
                items.map((e) => {
                  const st = STATUS_LABELS[e.status] ?? STATUS_LABELS.draft;
                  return (
                    <tr key={e.id} className="border-b hover:bg-slate-50 transition-colors group">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{e.estimateNumber}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {e.projectName ? (
                          <div>
                            <div className="font-medium text-slate-800 text-sm">{e.projectName}</div>
                            <div className="text-slate-400">{e.projectCode}</div>
                          </div>
                        ) : e.subject ? (
                          <span className="font-medium text-slate-800 text-sm">{e.subject}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">{e.clientName || "—"}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(e.estimateDate)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(e.taxIncludedAmount)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => dupMut.mutate(e.id)}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                            title="複写"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm("この見積書を削除しますか？")) delMut.mutate(e.id);
                            }}
                            className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <Link href={`/estimates/${e.id}`}>
                            <button className="p-1.5 rounded hover:bg-orange-50 text-slate-400 hover:text-orange-500">
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
