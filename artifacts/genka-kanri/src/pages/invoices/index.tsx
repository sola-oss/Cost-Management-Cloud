import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Receipt, Plus, Search, Trash2, ChevronRight, Printer } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  clientName: string;
  projectName: string;
  totalAmount: number;
  paidAmount: number;
  status: "unpaid" | "partial" | "paid";
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  unpaid: { label: "未入金", color: "bg-slate-100 text-slate-600 border-slate-200" },
  partial: { label: "一部入金", color: "bg-amber-100 text-amber-700 border-amber-200" },
  paid: { label: "入金済", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

async function fetchInvoices(status: string): Promise<{ items: Invoice[] }> {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  const res = await fetch(`${BASE}/api/invoices?${params}`);
  if (!res.ok) throw new Error("fetch error");
  return res.json();
}

async function deleteInvoice(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/invoices/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("delete error");
}

const fmt = (n: number) => `¥${n.toLocaleString()}`;
const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${y}/${m}/${day}`;
};

export default function InvoiceList() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/invoices", statusFilter],
    queryFn: () => fetchInvoices(statusFilter),
  });

  const delMut = useMutation({
    mutationFn: deleteInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "削除しました" });
    },
    onError: () => toast({ title: "エラー", variant: "destructive" }),
  });

  const allItems = data?.items ?? [];

  const items = allItems.filter((inv) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      inv.invoiceNumber.toLowerCase().includes(q) ||
      inv.clientName.toLowerCase().includes(q) ||
      (inv.projectName ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-orange-500" />
            請求管理
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">請求書の発行・入金管理を行います。</p>
        </div>
        <Link href="/invoices/new">
          <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
            <Plus className="w-4 h-4" />
            新規作成
          </Button>
        </Link>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(STATUS_LABELS).map(([key, { label, color }]) => {
          const count = allItems.filter((inv) => inv.status === key).length;
          const sum = allItems.filter((inv) => inv.status === key).reduce((s, inv) => s + inv.totalAmount, 0);
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
                { value: "unpaid", label: "未入金" },
                { value: "partial", label: "一部入金" },
                { value: "paid", label: "入金済" },
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
                  placeholder="番号・得意先・工事名…"
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
                <th className="text-left px-4 py-2.5">請求番号</th>
                <th className="text-left px-4 py-2.5">工事名</th>
                <th className="text-left px-4 py-2.5">得意先</th>
                <th className="text-left px-4 py-2.5">請求日</th>
                <th className="text-left px-4 py-2.5">入金期限</th>
                <th className="text-right px-4 py-2.5">請求金額（税込）</th>
                <th className="text-center px-4 py-2.5">ステータス</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400">読み込み中…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400">請求書がありません</td></tr>
              ) : (
                items.map((inv) => {
                  const st = STATUS_LABELS[inv.status] ?? STATUS_LABELS.unpaid;
                  return (
                    <tr key={inv.id} className="border-b hover:bg-slate-50 transition-colors group">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{inv.invoiceNumber}</td>
                      <td className="px-4 py-3 text-slate-700 text-sm max-w-[180px] truncate">{inv.projectName || "—"}</td>
                      <td className="px-4 py-3 font-medium">{inv.clientName || "—"}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(inv.invoiceDate)}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(inv.dueDate)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(inv.totalAmount)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => window.open(`${BASE}/invoices/${inv.id}/print`, "_blank")}
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                            title="印刷"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm("この請求書を削除しますか？")) delMut.mutate(inv.id);
                            }}
                            className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <Link href={`/invoices/${inv.id}`}>
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
