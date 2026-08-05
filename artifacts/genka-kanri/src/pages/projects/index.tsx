import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Search, FolderKanban, Calculator, Info, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { MasterSelect } from "@/components/master-select";
import { useStaffMembers } from "@/hooks/use-staff-members";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatPercent } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

/**
 * 小口工事（その他）の簡易登録ダイアログ。
 *
 * 通常の新規登録は工事番号・場所・得意先・着工日・竣工予定日まで必須で、
 * 金額の小さい工事を件数だけ登録するには重すぎる。ここは3つだけ聞いて、
 * 残りはサーバ側で埋める（工事番号は自動採番・日付は登録日）。
 */
function SmallProjectDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: staffMembers = [] } = useStaffMembers();
  const staffNames = staffMembers.filter((s) => s.isActive !== false).map((s) => s.name);

  const [name, setName] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [siteManager, setSiteManager] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(""); setContractAmount(""); setSiteManager(""); }
  }, [open]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "工事名を入力してください", variant: "destructive" });
      return;
    }
    const amount = parseFloat(contractAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "請負金額を入力してください", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/projects/small`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), contractAmount: amount, siteManager: siteManager || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "登録に失敗しました");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("/projects") });
      toast({ title: "小口工事を登録しました", description: `${name.trim()}（${formatCurrency(amount)}）` });
      // 通常タブのままだと登録した工事が画面に出ないので、小口タブへ移す
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: "登録できませんでした", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>小口工事の登録</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-slate-500 bg-slate-50 rounded px-2.5 py-2 leading-relaxed">
            金額の小さい工事はこの3つだけで登録します。実行予算と出来高は作らず、
            粗利は「請負金額 − 実績原価」で見ます。工事番号は自動で振られます。
          </p>
          <div>
            <Label>工事名 <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 山田様邸 給湯器交換"
              className="mt-1"
              autoFocus
            />
          </div>
          <div>
            <Label>請負金額 <span className="text-destructive">*</span></Label>
            <NumberInput
              value={contractAmount}
              onChange={(v) => setContractAmount(v)}
              className="mt-1 text-right"
              placeholder="0"
            />
          </div>
          <div>
            <Label>担当者</Label>
            <MasterSelect
              className="mt-1 text-sm"
              value={siteManager}
              onChange={setSiteManager}
              options={staffNames}
              placeholder="担当者を選択"
            />
            <p className="text-xs text-slate-400 mt-1">
              選んでおくと、担当者の「自分の現場」と仕入の振り分けで見つけやすくなります。
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            登録
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Projects() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // 既定は「通常の工事」。小口は件数が増え続けるので、開いた直後の一覧を埋めさせない
  const [typeFilter, setTypeFilter] = useState<string>("normal");
  const [smallDialogOpen, setSmallDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // 入力から300ms後に検索を確定（打つたびにAPIを叩かない）
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // limit を明示しないとサーバ既定の20件で打ち切られ、21件目以降の工事が一覧から消える。
  const params = {
    limit: 2000,
    ...(statusFilter !== "all" ? { status: statusFilter as "planning" | "active" | "completed" | "suspended" } : {}),
    ...(typeFilter !== "all" ? { managementType: typeFilter as "normal" | "small" } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  };

  const { data, isLoading, isError } = useListProjects(params, {
    query: { queryKey: getListProjectsQueryKey(params) },
  });

  const projects = data?.items ?? [];
  const counts = data?.counts ?? { normal: 0, small: 0 };
  const isSmallTab = typeFilter === "small";

  // 小口タブの合計（この画面で全体が分かるように。ダッシュボードを見に行かなくて済む）
  const smallTotals = projects.reduce(
    (acc, p) => {
      acc.contract += p.contractAmount ?? 0;
      acc.cost += p.totalActualCost ?? 0;
      return acc;
    },
    { contract: 0, cost: 0 },
  );
  const smallProfit = smallTotals.contract - smallTotals.cost;

  const TABS: { value: string; label: string; count: number | null }[] = [
    { value: "normal", label: "通常の工事", count: counts.normal },
    { value: "small", label: "小口工事", count: counts.small },
    { value: "all", label: "すべて", count: counts.normal + counts.small },
  ];

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
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={() => setSmallDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            小口工事を登録
          </Button>
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="w-4 h-4 mr-2" />
              新規工事登録
            </Link>
          </Button>
        </div>
      </div>

      <SmallProjectDialog
        open={smallDialogOpen}
        onClose={() => setSmallDialogOpen(false)}
        onSaved={() => setTypeFilter("small")}
      />

      <Card>
        {/* 区分のタブ。小口が増えても通常の工事一覧が埋もれないよう既定は「通常の工事」 */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b">
          {TABS.map((t) => {
            const active = typeFilter === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTypeFilter(t.value)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
                {!isLoading && (
                  <span className={`ml-1.5 text-xs tabular-nums ${active ? "text-primary" : "text-slate-400"}`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="工事名・番号・得意先で検索..."
                className="pl-9 bg-slate-50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
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
            {isSmallTab ? (
              /* 小口は実行予算も出来高も作らないので、空欄が並ぶ通常の表ではなく専用の表にする */
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>工事名称</TableHead>
                    <TableHead className="w-[140px]">担当者</TableHead>
                    <TableHead className="text-right w-[140px]">請負金額</TableHead>
                    <TableHead className="text-right w-[140px]">実績原価</TableHead>
                    <TableHead className="text-right w-[140px]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 cursor-help">
                            粗利
                            <Info className="w-3.5 h-3.5 text-slate-400" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          <p className="font-medium">粗利 ＝ 請負金額 − 実績原価</p>
                          <p className="mt-1 text-slate-300">小口工事は実行予算を作らないため、実績で見ます。</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    ))
                  ) : isError ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-destructive">
                        データの取得に失敗しました。再度お試しください。
                      </TableCell>
                    </TableRow>
                  ) : projects.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                        小口工事はまだありません。右上の「小口工事を登録」から追加できます。
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {projects.map((project) => {
                        const profit = (project.contractAmount ?? 0) - (project.totalActualCost ?? 0);
                        return (
                          <TableRow key={project.id} className="hover:bg-slate-50/50">
                            <TableCell className="font-medium text-slate-900">
                              {project.name}
                              <span className="ml-2 font-mono text-xs text-slate-400">{project.projectCode}</span>
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">{project.siteManager ?? "—"}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(project.contractAmount)}</TableCell>
                            <TableCell className="text-right text-slate-600">{formatCurrency(project.totalActualCost)}</TableCell>
                            <TableCell className={`text-right font-medium ${profit < 0 ? "text-destructive" : "text-emerald-600"}`}>
                              {formatCurrency(profit)}
                              {project.grossProfitRate != null && (
                                <span className="ml-1 text-xs text-slate-400">{formatPercent(project.grossProfitRate)}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" asChild>
                                <Link href={`/projects/${project.id}`}>詳細</Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {/* 合計。小口を入れる目的は「全体を知ること」なので、この画面で足し算を終わらせる */}
                      <TableRow className="bg-slate-50 font-semibold hover:bg-slate-50">
                        <TableCell colSpan={2} className="text-slate-700">合計（{projects.length}件）</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(smallTotals.contract)}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-700">{formatCurrency(smallTotals.cost)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${smallProfit < 0 ? "text-destructive" : "text-emerald-600"}`}>
                          {formatCurrency(smallProfit)}
                          {smallTotals.contract > 0 && (
                            <span className="ml-1 text-xs font-normal text-slate-400">
                              {formatPercent(Math.round((smallProfit / smallTotals.contract) * 1000) / 10)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            ) : (
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
                  <TableHead className="text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 cursor-help">
                          粗利率
                          <Info className="w-3.5 h-3.5 text-slate-400" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        <p className="font-medium">予定粗利率 ＝（請負金額 − 実行予算）÷ 請負金額</p>
                        <p className="mt-1 text-slate-300">計画段階の採算（実績原価ではなく実行予算で計算）。実行予算が未設定の工事は「—」表示。</p>
                        <p className="mt-1 text-slate-300">小口工事は実行予算を作らないため、（請負金額 − 実績原価）で計算します。</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
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
                      <TableCell className="font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          <span>{project.name}</span>
                          {project.managementType === "small" && (
                            <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200 shrink-0">
                              小口
                            </Badge>
                          )}
                        </div>
                      </TableCell>
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
                        {project.managementType === "small" ? (
                          // 小口工事は実行予算を作らないので消化率が出ない（0%と出すと誤解を招く）
                          <span className="text-xs text-slate-300">予算なし</span>
                        ) : (
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
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {project.grossProfitRate == null ? (
                          <span className="text-slate-300" title="実行予算が未設定のため算定できません">—</span>
                        ) : (
                          <span className={project.grossProfitRate < 10 ? "text-destructive" : "text-emerald-600"}>
                            {formatPercent(project.grossProfitRate)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {project.managementType !== "small" && (
                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                              className="gap-1 text-teal-700 border-teal-300 hover:bg-teal-50"
                            >
                              <Link href={`/projects/${project.id}/budgets`}>
                                <Calculator className="w-3.5 h-3.5" />
                                実行予算
                              </Link>
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/projects/${project.id}`}>詳細</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
