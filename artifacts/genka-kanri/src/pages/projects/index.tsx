import { useState } from "react";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Search, FolderKanban } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  planning: "計画中",
  active: "施工中",
  completed: "完工",
  suspended: "中断",
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-slate-100 text-slate-700",
  active: "bg-orange-100 text-orange-700 border-orange-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  suspended: "bg-red-100 text-red-700 border-red-200",
};

export default function Projects() {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const params = statusFilter !== "all" ? { status: statusFilter as "planning" | "active" | "completed" | "suspended" } : undefined;

  const { data, isLoading, isError } = useListProjects(params, {
    query: { queryKey: getListProjectsQueryKey(params) },
  });

  const projects = data?.items ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <FolderKanban className="w-6 h-6 text-primary" />
            工事一覧
          </h1>
          <p className="text-sm text-slate-500 mt-1">すべての工事プロジェクトと進捗状況を管理します。</p>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/projects/new">
            <Plus className="w-4 h-4 mr-2" />
            新規工事登録
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="工事名や番号で検索..." className="pl-9 bg-slate-50" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="ステータス絞り込み" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                <SelectItem value="planning">計画中</SelectItem>
                <SelectItem value="active">施工中</SelectItem>
                <SelectItem value="completed">完工</SelectItem>
                <SelectItem value="suspended">中断</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="w-[120px]">工事番号</TableHead>
                  <TableHead>工事名称</TableHead>
                  <TableHead>得意先名</TableHead>
                  <TableHead className="w-[100px]">状態</TableHead>
                  <TableHead className="text-right">請負金額</TableHead>
                  <TableHead className="text-right">実績原価</TableHead>
                  <TableHead className="text-center w-[180px]">予算消化率</TableHead>
                  <TableHead className="text-right">粗利率</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-2 w-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-destructive">
                      データの取得に失敗しました。再度お試しください。
                    </TableCell>
                  </TableRow>
                ) : projects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-slate-500">
                      工事が見つかりません
                    </TableCell>
                  </TableRow>
                ) : (
                  projects.map((project) => (
                    <TableRow key={project.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-mono text-xs text-slate-600">{project.projectCode}</TableCell>
                      <TableCell className="font-medium text-slate-900">{project.name}</TableCell>
                      <TableCell className="text-sm text-slate-600">{project.clientName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[project.status] ?? ""}>
                          {STATUS_LABELS[project.status] ?? project.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(project.contractAmount)}
                      </TableCell>
                      <TableCell className="text-right text-slate-600">
                        {formatCurrency(project.totalActualCost)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={Math.min(project.budgetUsageRate, 100)}
                            className="h-2 flex-1"
                            indicatorClassName={project.budgetUsageRate > 100 ? "bg-destructive" : "bg-primary"}
                          />
                          <span className={`text-xs font-medium w-9 text-right ${project.budgetUsageRate > 100 ? "text-destructive" : "text-slate-600"}`}>
                            {project.budgetUsageRate.toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <span className={project.grossProfitRate < 10 ? "text-destructive" : "text-emerald-600"}>
                          {formatPercent(project.grossProfitRate)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/projects/${project.id}`}>詳細</Link>
                        </Button>
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
