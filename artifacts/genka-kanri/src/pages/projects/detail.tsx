import { useParams, Link } from "wouter";
import { 
  useGetProject, useGetProjectSummary, useListCostItems, useGetBudgetVsActual,
  getGetProjectQueryKey, getGetProjectSummaryQueryKey, getListCostItemsQueryKey, getGetBudgetVsActualQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { ArrowLeft, Edit, Plus, JapaneseYen, Calculator, TrendingUp, AlertTriangle } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/utils";

const STATUS_LABELS = {
  planning: "計画中",
  active: "施工中",
  completed: "完工",
  suspended: "中断",
};

const CATEGORY_LABELS = {
  material: "材料費",
  labor: "労務費",
  subcontract: "外注費",
  expense: "経費",
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0", 10);

  const { data: project, isLoading: projectLoading } = useGetProject(projectId, { 
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } 
  });
  const { data: summary, isLoading: summaryLoading } = useGetProjectSummary(projectId, { 
    query: { enabled: !!projectId, queryKey: getGetProjectSummaryQueryKey(projectId) } 
  });
  const { data: costItems, isLoading: costsLoading } = useListCostItems({ projectId }, { 
    query: { enabled: !!projectId, queryKey: getListCostItemsQueryKey({ projectId }) } 
  });
  const { data: budgetVsActual, isLoading: chartLoading } = useGetBudgetVsActual({ projectId }, { 
    query: { enabled: !!projectId, queryKey: getGetBudgetVsActualQueryKey({ projectId }) } 
  });

  if (projectLoading) {
    return <div className="p-6 max-w-7xl mx-auto space-y-6"><Skeleton className="h-40 w-full" /></div>;
  }

  if (!project) return <div className="p-6">Project not found</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-2">
        <Button variant="outline" size="icon" asChild>
          <Link href="/projects"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{project.name}</h1>
            <Badge variant={project.status === "active" ? "default" : "secondary"}>
              {STATUS_LABELS[project.status as keyof typeof STATUS_LABELS]}
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">{project.projectCode} • {project.clientName}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/projects/${project.id}/budgets`}>
              <Calculator className="w-4 h-4 mr-2" />
              予算管理
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/projects/${project.id}/costs/new`}>
              <Plus className="w-4 h-4 mr-2" />
              原価入力
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-50 border-none shadow-sm">
          <CardHeader className="py-4">
            <CardTitle className="text-sm text-slate-500 font-medium">請負金額</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(project.contractAmount)}</div>
          </CardContent>
        </Card>
        
        {summaryLoading ? (
          <>
            <Card><CardContent className="p-6"><Skeleton className="h-10" /></CardContent></Card>
            <Card><CardContent className="p-6"><Skeleton className="h-10" /></CardContent></Card>
            <Card><CardContent className="p-6"><Skeleton className="h-10" /></CardContent></Card>
          </>
        ) : summary ? (
          <>
            <Card className="border-none shadow-sm shadow-emerald-100">
              <CardHeader className="py-4">
                <CardTitle className="text-sm text-slate-500 font-medium">予想粗利</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div className={`text-2xl font-bold ${summary.grossProfit < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                    {formatCurrency(summary.grossProfit)}
                  </div>
                  <div className={`text-sm font-bold mb-1 ${summary.grossProfitRate < 10 ? 'text-destructive' : 'text-emerald-600'}`}>
                    {formatPercent(summary.grossProfitRate)}
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm shadow-blue-100">
              <CardHeader className="py-4">
                <CardTitle className="text-sm text-slate-500 font-medium">予算合計</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{formatCurrency(summary.totalBudget)}</div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm shadow-orange-100">
              <CardHeader className="py-4">
                <CardTitle className="text-sm text-slate-500 font-medium flex items-center justify-between">
                  実績原価
                  {summary.budgetUsageRate > 100 && <AlertTriangle className="w-4 h-4 text-destructive" />}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">{formatCurrency(summary.totalActualCost)}</div>
                <div className="mt-2 flex items-center gap-2">
                  <Progress 
                    value={Math.min(summary.budgetUsageRate, 100)} 
                    className="h-1.5 flex-1" 
                    indicatorClassName={summary.budgetUsageRate > 100 ? "bg-destructive" : "bg-orange-500"} 
                  />
                  <span className={`text-xs font-medium ${summary.budgetUsageRate > 100 ? 'text-destructive' : 'text-slate-500'}`}>
                    {summary.budgetUsageRate.toFixed(1)}%
                  </span>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">予算・実績推移</CardTitle>
            <CardDescription>項目別の予算と実績の比較</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {chartLoading ? (
                <Skeleton className="h-full w-full" />
              ) : budgetVsActual?.items ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={budgetVsActual.items} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(val) => `¥${(val/10000).toFixed(0)}万`} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="budget" name="予算" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={50} />
                    <Bar dataKey="actual" name="実績" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={50} />
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
            <CardTitle className="text-base">基本情報</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-slate-500 mb-1">工事場所</div>
              <div className="font-medium">{project.location}</div>
            </div>
            <div>
              <div className="text-slate-500 mb-1">工期</div>
              <div className="font-medium">
                {new Date(project.startDate).toLocaleDateString('ja-JP')} 〜 {new Date(project.endDate).toLocaleDateString('ja-JP')}
              </div>
            </div>
            {project.description && (
              <div>
                <div className="text-slate-500 mb-1">備考</div>
                <div className="font-medium whitespace-pre-wrap">{project.description}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b py-4">
          <div>
            <CardTitle className="text-base">最近の原価明細</CardTitle>
            <CardDescription>直近に計上された原価</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/costs/new`}>明細追加</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="w-[120px]">発生日</TableHead>
                  <TableHead className="w-[100px]">区分</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead>取引先</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">単価</TableHead>
                  <TableHead className="text-right font-bold">金額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={7} className="h-12"><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                  ))
                ) : costItems?.items?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-slate-500">原価明細がありません</TableCell>
                  </TableRow>
                ) : (
                  costItems?.items.slice(0, 10).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-slate-600">{new Date(item.incurredDate).toLocaleDateString('ja-JP')}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{item.description}</TableCell>
                      <TableCell className="text-slate-600">{item.vendor || "-"}</TableCell>
                      <TableCell className="text-right">
                        {item.quantity ? `${item.quantity} ${item.unit || ''}` : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.unitPrice ? formatCurrency(item.unitPrice) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900">
                        {formatCurrency(item.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
