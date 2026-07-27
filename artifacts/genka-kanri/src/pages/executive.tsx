import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useGetCostByCategory, useGetMonthlyCosts } from "@workspace/api-client-react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, AlertTriangle, ChevronDown, ChevronUp, Clock, PackageOpen } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── 社長ダッシュボード ──────────────────────────────────────────────────────
//
// 社長が知りたいのは「今いくら」ではなく「このあとどうなるか」。
// 危ない工事を最初に、次に全体、最後に工事一覧という順で並べる。
// スマホで見る前提（移動中に開く）。

interface ProjectRow {
  id: number;
  projectCode: string;
  name: string;
  clientName: string;
  siteManager: string | null;
  contractAmount: number;
  totalBudget: number;
  totalActualCost: number;
  budgetRemaining: number;
  unbilledOrder: number;
  progressRate: number | null;
  progressYearMonth: string | null;
  costConsumptionRate: number | null;
  gap: number | null;
  plannedProfit: number | null;
  plannedProfitRate: number | null;
  forecastCost: number | null;
  forecastProfit: number | null;
  forecastProfitRate: number | null;
  forecastUnavailableReason: string | null;
  overBudget: boolean;
}
interface AlertRow extends ProjectRow { reasons: string[]; severity: number }
interface Data {
  summary: {
    contractTotal: number; budgetTotal: number; actualCostTotal: number; unbilledOrderTotal: number;
    plannedProfit: number; plannedProfitRate: number | null;
    forecastProfit: number | null; forecastProfitRate: number | null;
    activeProjects: number;
  };
  alerts: AlertRow[];
  projects: ProjectRow[];
  freshness: {
    projectsWithoutProgress: number; staleProgressProjects: number;
    pendingReceivedInvoices: number; lastCostAt: string | null; thisYearMonth: string;
  };
}

function profitTone(rate: number | null): string {
  if (rate == null) return "text-slate-400";
  if (rate < 0) return "text-red-600";
  if (rate < 10) return "text-amber-600";
  return "text-emerald-600";
}

// 原価の内訳グラフ。旧「ダッシュボード」から統合したもの（画面が2つあると分かりにくいため）。
const CHART_COLORS = ["#f97316", "#0f172a", "#0284c7", "#10b981"];

function CostCharts() {
  const { data: costByCategory, isLoading: categoryLoading } = useGetCostByCategory();
  const { data: monthlyCosts, isLoading: monthlyLoading } = useGetMonthlyCosts();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">原価項目別の構成</div>
          <div className="h-[220px] w-full">
            {categoryLoading ? <Skeleton className="h-full w-full" /> : costByCategory?.categories ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={costByCategory.categories} cx="50%" cy="50%" innerRadius={45} outerRadius={80}
                       paddingAngle={2} dataKey="amount" nameKey="label" isAnimationActive={false}>
                    {costByCategory.categories.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : null}
          </div>
          {costByCategory?.categories && (
            <div className="flex flex-wrap gap-3 justify-center mt-2">
              {costByCategory.categories.map((c, i) => (
                <div key={c.category} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="text-slate-600">{c.label}</span>
                  <span className="font-medium tabular-nums">{c.percentage}%</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">月別の原価推移</div>
          <div className="h-[220px] w-full">
            {monthlyLoading ? <Skeleton className="h-full w-full" /> : monthlyCosts?.months ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyCosts.months}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Area type="monotone" dataKey="total" stroke="#f97316" fill="#fdba74" fillOpacity={0.3} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Executive() {
  const [openAll, setOpenAll] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/executive"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/executive`);
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<Data>;
    },
  });

  if (isLoading) {
    return <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
    </div>;
  }
  if (!data) return <div className="p-6 text-center text-slate-400">取得できませんでした</div>;

  const s = data.summary;
  const f = data.freshness;
  const shown = openAll ? data.projects : data.projects.slice(0, 5);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-primary" />
          ダッシュボード
        </h1>
        <p className="text-sm text-slate-500 mt-1">施工中 {s.activeProjects} 件の状況と、このあとの着地見込みです。</p>
      </div>

      {/* 注意が要る工事を最初に。見に行かせるのではなく、危ない方から知らせる */}
      {data.alerts.length > 0 && (
        <Card className="border-red-200 bg-red-50/40">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <AlertTriangle className="w-4 h-4" />
              注意が要る工事（{data.alerts.length}件）
            </div>
            <div className="space-y-2">
              {data.alerts.map((a) => (
                <Link key={a.id} href={`/projects/${a.id}/ledger`}>
                  <div className="bg-white rounded-md border border-red-100 p-3 hover:border-red-300 transition-colors cursor-pointer">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 text-sm truncate">{a.name}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {a.reasons.map((r) => (
                            <Badge key={r} variant="outline" className="text-xs border-red-200 bg-red-50 text-red-700">{r}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-slate-500">着地見込み</div>
                        <div className={`text-sm font-bold tabular-nums ${profitTone(a.forecastProfitRate)}`}>
                          {a.forecastProfit != null ? formatCurrency(a.forecastProfit) : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 全体 */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-slate-500">請負金額</div>
              <div className="text-lg font-bold tabular-nums">{formatCurrency(s.contractTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">実行予算</div>
              <div className="text-lg font-bold tabular-nums text-slate-700">{formatCurrency(s.budgetTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">実績原価</div>
              <div className="text-lg font-bold tabular-nums text-slate-700">{formatCurrency(s.actualCostTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 flex items-center gap-1">
                <PackageOpen className="w-3 h-3" />未請求の発注残
              </div>
              <div className="text-lg font-bold tabular-nums text-amber-600">{formatCurrency(s.unbilledOrderTotal)}</div>
            </div>
          </div>

          <div className="border-t pt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-slate-500">予定粗利（請負−予算）</div>
              <div className={`text-xl font-bold tabular-nums ${profitTone(s.plannedProfitRate)}`}>
                {formatCurrency(s.plannedProfit)}
              </div>
              <div className="text-xs text-slate-400 tabular-nums">
                {s.plannedProfitRate != null ? `${s.plannedProfitRate}%` : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">着地見込み（今のペース）</div>
              <div className={`text-xl font-bold tabular-nums ${profitTone(s.forecastProfitRate)}`}>
                {s.forecastProfit != null ? formatCurrency(s.forecastProfit) : "—"}
              </div>
              <div className="text-xs text-slate-400 tabular-nums">
                {s.forecastProfitRate != null ? `${s.forecastProfitRate}%` : "—"}
              </div>
            </div>
          </div>

          {s.unbilledOrderTotal > 0 && (
            <p className="text-xs text-slate-500 bg-slate-50 rounded px-2 py-1.5">
              発注済みで請求がまだ来ていない分が {formatCurrency(s.unbilledOrderTotal)} あります。この分は実績原価にまだ入っていません。
            </p>
          )}
        </CardContent>
      </Card>

      {/* データの鮮度。数字を信じてよいかの判断材料 */}
      {(f.projectsWithoutProgress > 0 || f.staleProgressProjects > 0 || f.pendingReceivedInvoices > 0) && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
              <Clock className="w-4 h-4" />
              数字の鮮度
            </div>
            <ul className="text-xs text-amber-800 space-y-1">
              {f.projectsWithoutProgress > 0 && (
                <li>・出来高が未入力の工事が {f.projectsWithoutProgress} 件あります（着地見込みが出せません）</li>
              )}
              {f.staleProgressProjects > 0 && (
                <li>・出来高が先月以前のままの工事が {f.staleProgressProjects} 件あります</li>
              )}
              {f.pendingReceivedInvoices > 0 && (
                <li>・振り分けが済んでいない書類が {f.pendingReceivedInvoices} 件あります（原価にまだ入っていません）</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      <CostCharts />

      {/* 工事別 */}
      <div className="space-y-2">
        <div className="text-sm font-semibold text-slate-700 px-1">工事別</div>
        {shown.map((p) => (
          <Card key={p.id} className={p.overBudget ? "border-l-4 border-l-red-500" : ""}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800 truncate">{p.name}</div>
                  <div className="text-xs text-slate-500">
                    <span className="font-mono">{p.projectCode}</span>
                    {p.siteManager ? ` ・ ${p.siteManager}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-500">着地見込み</div>
                  <div className={`font-bold tabular-nums ${profitTone(p.forecastProfitRate)}`}>
                    {p.forecastProfitRate != null ? `${p.forecastProfitRate}%` : "—"}
                  </div>
                  {p.forecastProfitRate == null && p.forecastUnavailableReason && (
                    <div className="text-[10px] text-slate-400 leading-tight">{p.forecastUnavailableReason}</div>
                  )}
                </div>
              </div>

              {/* 進捗と原価の対比。ズレが危険信号 */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs bg-slate-50 rounded py-2">
                <div>
                  <div className="text-slate-500">出来高</div>
                  <div className="font-semibold tabular-nums">
                    {p.progressRate != null ? `${p.progressRate}%` : <span className="text-amber-600">未入力</span>}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">原価消化</div>
                  <div className="font-semibold tabular-nums">
                    {p.costConsumptionRate != null ? `${p.costConsumptionRate}%` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">ズレ</div>
                  <div className={`font-semibold tabular-nums ${p.gap != null && p.gap >= 15 ? "text-red-600" : p.gap != null && p.gap > 0 ? "text-amber-600" : "text-slate-600"}`}>
                    {p.gap != null ? `${p.gap > 0 ? "+" : ""}${p.gap}pt` : "—"}
                  </div>
                </div>
              </div>

              <div className="flex justify-between text-xs text-slate-500 tabular-nums">
                <span>予定粗利 {p.plannedProfit != null ? formatCurrency(p.plannedProfit) : "—"}</span>
                {p.unbilledOrder > 0 && <span className="text-amber-600">発注残 {formatCurrency(p.unbilledOrder)}</span>}
              </div>
            </CardContent>
          </Card>
        ))}

        {data.projects.length > 5 && (
          <button
            type="button"
            onClick={() => setOpenAll((v) => !v)}
            className="w-full text-sm text-primary hover:underline underline-offset-2 flex items-center justify-center gap-1 py-2"
          >
            {openAll ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {openAll ? "上位5件だけ表示" : `残り${data.projects.length - 5}件を表示`}
          </button>
        )}
      </div>

      <p className="text-xs text-slate-400 px-1">
        着地見込み＝請負金額 −（実績原価 ÷ 出来高）。出来高が未入力の工事は予定粗利で代用しています。
      </p>
    </div>
  );
}
