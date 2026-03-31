import { useGetDashboardOverview, useGetCostByCategory, useGetMonthlyCosts, getGetDashboardOverviewQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { AlertCircle, Building, CheckCircle2, AlertTriangle, TrendingUp, DollarSign } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: overview, isLoading: overviewLoading } = useGetDashboardOverview({ query: { queryKey: getGetDashboardOverviewQueryKey() } });
  const { data: costByCategory, isLoading: categoryLoading } = useGetCostByCategory();
  const { data: monthlyCosts, isLoading: monthlyLoading } = useGetMonthlyCosts();

  const COLORS = ['#f97316', '#0f172a', '#0284c7', '#10b981'];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">ダッシュボード</h1>
      </div>

      {overviewLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : overview ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">施工中工事</CardTitle>
              <Building className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overview.activeProjects} <span className="text-sm font-normal text-slate-500">件</span></div>
              <p className="text-xs text-slate-500 mt-1">全 {overview.totalProjects} 件中</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">請負金額合計</CardTitle>
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(overview.totalContractAmount)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">実績原価合計</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(overview.totalActualCost)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">平均粗利率</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-slate-700" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatPercent(overview.averageGrossProfitRate)}</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="text-base font-semibold">原価項目別構成</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {categoryLoading ? (
                <Skeleton className="h-full w-full" />
              ) : costByCategory?.categories ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={costByCategory.categories}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="amount"
                      nameKey="label"
                    >
                      {costByCategory.categories.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : null}
            </div>
            {costByCategory?.categories && (
              <div className="flex flex-wrap gap-4 justify-center mt-4">
                {costByCategory.categories.map((cat, idx) => (
                  <div key={cat.category} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                    <span className="text-slate-600">{cat.label}</span>
                    <span className="font-medium">{formatPercent(cat.percentage)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="text-base font-semibold">月別原価推移</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {monthlyLoading ? (
                <Skeleton className="h-full w-full" />
              ) : monthlyCosts?.months ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyCosts.months}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(val) => `¥${(val/10000).toFixed(0)}万`} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Area type="monotone" dataKey="total" stroke="#f97316" fill="#fdba74" fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-destructive/20 shadow-sm">
          <CardHeader className="bg-destructive/5 border-b border-destructive/10">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              予算超過リスクのある工事
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {overviewLoading ? (
              <div className="p-4"><Skeleton className="h-20 w-full" /></div>
            ) : overview?.alertProjects?.length ? (
              <div className="divide-y">
                {overview.alertProjects.map(project => (
                  <Link key={project.id} href={`/projects/${project.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                    <div>
                      <div className="font-medium text-slate-900">{project.name}</div>
                      <div className="text-sm text-slate-500">{project.projectCode}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-destructive font-bold">{formatPercent(project.budgetUsageRate)}</div>
                      <div className="text-xs text-slate-500">消化率</div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500">
                リスクのある工事はありません
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-slate-50/50">
            <CardTitle className="text-base font-semibold">最近の工事</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {overviewLoading ? (
              <div className="p-4"><Skeleton className="h-40 w-full" /></div>
            ) : overview?.recentProjects?.length ? (
              <div className="divide-y">
                {overview.recentProjects.map(project => (
                  <Link key={project.id} href={`/projects/${project.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                    <div>
                      <div className="font-medium text-slate-900">{project.name}</div>
                      <div className="text-sm text-slate-500">{project.projectCode} • {project.clientName}</div>
                    </div>
                    <div>
                      <Badge variant={project.status === "active" ? "default" : "secondary"}>
                        {project.status === "active" ? "施工中" : 
                         project.status === "planning" ? "計画中" : 
                         project.status === "completed" ? "完工" : "中断"}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500">
                データがありません
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
