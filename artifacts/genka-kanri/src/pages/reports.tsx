import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import { FileSpreadsheet, Download } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";

export default function Reports() {
  const { data, isLoading } = useListProjects({ limit: 50 }, { 
    query: { queryKey: getListProjectsQueryKey({ limit: 50 }) } 
  });

  // Prepare chart data (sort by gross profit rate descending)
  const chartData = data?.items
    .filter(p => p.status === 'active' || p.status === 'completed')
    .sort((a, b) => b.grossProfitRate - a.grossProfitRate)
    .slice(0, 15)
    .map(p => ({
      name: p.name.length > 10 ? p.name.substring(0, 10) + '...' : p.name,
      fullName: p.name,
      grossProfitRate: p.grossProfitRate,
      budgetUsageRate: p.budgetUsageRate,
      status: p.status,
    })) || [];

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
        <Button variant="outline">
          <Download className="w-4 h-4 mr-2" />
          CSV出力
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>粗利率比較 (上位15件)</CardTitle>
            <CardDescription>施工中・完工済の工事における粗利率（%）</CardDescription>
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
                    <Bar dataKey="grossProfitRate" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.grossProfitRate < 10 ? '#ef4444' : '#10b981'} />
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
                      .filter(p => p.budgetUsageRate > 100 || p.grossProfitRate < 10)
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
