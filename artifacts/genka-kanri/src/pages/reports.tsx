import { useState } from "react";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import { FileSpreadsheet, Download } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { formatCurrency, formatPercent } from "@/lib/utils";

export default function Reports() {
  const { data, isLoading } = useListProjects({ limit: 50 }, { 
    query: { queryKey: getListProjectsQueryKey({ limit: 50 }) } 
  });

  // チャートの絞り込み・並び替え
  const [statusFilter, setStatusFilter] = useState<"inprogress_done" | "active" | "completed" | "planning" | "all">("inprogress_done");
  const [sortOrder, setSortOrder] = useState<"low" | "high">("low");

  const matchStatus = (s: string | undefined | null) => {
    switch (statusFilter) {
      case "inprogress_done": return s === "active" || s === "completed";
      case "active": return s === "active";
      case "completed": return s === "completed";
      case "planning": return s === "planning";
      case "all": return true;
      default: return true;
    }
  };

  // 並び替え：低い順（ワースト先頭）が既定。粗利率が算定不可(null)の工事は末尾に回す
  const chartData = (data?.items ?? [])
    .filter(p => matchStatus(p.status))
    .slice()
    .sort((a, b) => {
      const av = a.grossProfitRate ?? (sortOrder === "low" ? Infinity : -Infinity);
      const bv = b.grossProfitRate ?? (sortOrder === "low" ? Infinity : -Infinity);
      return sortOrder === "low" ? av - bv : bv - av;
    })
    .map(p => ({
      name: p.name.length > 10 ? p.name.substring(0, 10) + '...' : p.name,
      fullName: p.name,
      grossProfitRate: p.grossProfitRate,
      budgetUsageRate: p.budgetUsageRate,
      status: p.status,
    }));

  const statusLabel: Record<string, string> = {
    planning: "計画中", active: "施工中", completed: "完工", suspended: "中断",
  };

  // 工事ごとの収支サマリを CSV（Excelでそのまま開けるよう UTF-8 BOM 付き）で出力
  const handleExportCsv = () => {
    const rows = data?.items ?? [];
    if (rows.length === 0) return;
    const header = ["工事番号", "工事名", "得意先", "状態", "請負金額", "実行予算", "実績原価", "予算消化率(%)", "粗利率(%)", "予定粗利額", "実績粗利額"];
    const cell = (v: string | number | null | undefined) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = rows.map((p) => [
      p.projectCode ?? "",
      p.name ?? "",
      p.clientName ?? "",
      statusLabel[p.status as string] ?? p.status ?? "",
      p.contractAmount ?? 0,
      p.totalBudget ?? 0,
      p.totalActualCost ?? 0,
      p.budgetUsageRate ?? 0,
      p.grossProfitRate ?? "",
      (p.contractAmount ?? 0) - (p.totalBudget ?? 0),
      (p.contractAmount ?? 0) - (p.totalActualCost ?? 0),
    ].map(cell).join(","));
    const csv = "﻿" + [header.join(","), ...body].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `収支レポート_${ymd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-primary" />
            収支レポート
          </h1>
          <p className="text-sm text-slate-500 mt-1">工事横断での粗利率・予算消化状況の分析。</p>
        </div>
        <Button variant="outline" onClick={handleExportCsv} disabled={!data?.items?.length}>
          <Download className="w-4 h-4 mr-2" />
          CSV出力
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle>粗利率比較</CardTitle>
                <CardDescription>工事ごとの粗利率（予定：請負金額 − 実行予算）。低い順＝採算が危ない工事が先頭。</CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                  <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inprogress_done">施工中・完工</SelectItem>
                    <SelectItem value="active">施工中のみ</SelectItem>
                    <SelectItem value="completed">完工のみ</SelectItem>
                    <SelectItem value="planning">計画中（予定）</SelectItem>
                    <SelectItem value="all">すべて</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as typeof sortOrder)}>
                  <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">粗利率：低い順</SelectItem>
                    <SelectItem value="high">粗利率：高い順</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              {isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" tick={{ fontSize: 11 }} height={60} />
                    <YAxis tickFormatter={(val) => `${val}%`} />
                    <Tooltip 
                      formatter={(value: number, name: string) => [formatPercent(value), name === 'grossProfitRate' ? '粗利率' : name]}
                      labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                    />
                    <Bar dataKey="grossProfitRate" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.grossProfitRate != null && entry.grossProfitRate < 10 ? '#ef4444' : '#10b981'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-500">データがありません</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>要注意プロジェクト</CardTitle>
            <CardDescription>予算消化率が100%を超過、または粗利率が10%を下回る工事</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-destructive/5">
                  <TableRow>
                    <TableHead>工事名称</TableHead>
                    <TableHead className="text-right">請負金額</TableHead>
                    <TableHead className="text-right">予算合計</TableHead>
                    <TableHead className="text-right">実績原価</TableHead>
                    <TableHead className="text-center">予算消化率</TableHead>
                    <TableHead className="text-right">粗利率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={6} className="h-12 text-center">読み込み中...</TableCell></TableRow>
                  ) : (
                    data?.items
                      .filter(p => p.budgetUsageRate > 100 || (p.grossProfitRate != null && p.grossProfitRate < 10))
                      .map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium text-slate-900">{p.name}</TableCell>
                          <TableCell className="text-right">{formatCurrency(p.contractAmount)}</TableCell>
                          <TableCell className="text-right text-blue-700">{formatCurrency(p.totalBudget)}</TableCell>
                          <TableCell className="text-right text-orange-700">{formatCurrency(p.totalActualCost)}</TableCell>
                          <TableCell className="text-center font-bold text-destructive">
                            {p.budgetUsageRate.toFixed(1)}%
                          </TableCell>
                          <TableCell className={`text-right font-bold ${p.grossProfitRate < 10 ? 'text-destructive' : ''}`}>
                            {formatPercent(p.grossProfitRate)}
                          </TableCell>
                        </TableRow>
                      )) || <TableRow><TableCell colSpan={6} className="h-24 text-center text-slate-500">該当する工事はありません</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
