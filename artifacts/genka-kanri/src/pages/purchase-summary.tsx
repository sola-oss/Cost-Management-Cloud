import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calculator, Loader2, RefreshCw, Info } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useVendors } from "@/hooks/use-vendors";

interface VendorGroup {
  id: number;
  name: string;
}

interface VendorItem {
  id: number;
  name: string;
  groupId: number | null;
  closingDay: number;
  paymentMonths: number;
  paymentDay: number;
}

interface SummaryItem {
  vendor: string;
  projectId: number;
  projectCode?: string;
  projectName?: string;
  workType?: string;
  totalAmount: number;
  costItemIds: number[];
}

interface CalculateResponse {
  items: SummaryItem[];
  total: number;
  effectiveStart: string;
  effectiveEnd: string;
}

const CLOSING_DAY_OPTIONS = [
  { value: "none", label: "指定なし（日付をそのまま使用）" },
  { value: "5", label: "5日締め" },
  { value: "10", label: "10日締め" },
  { value: "15", label: "15日締め" },
  { value: "20", label: "20日締め" },
  { value: "25", label: "25日締め" },
  { value: "99", label: "月末締め" },
];

const SUMMARY_TYPE_OPTIONS = [
  { value: "vendor", label: "仕入先別" },
  { value: "vendor_project", label: "仕入先別工事毎" },
  { value: "vendor_project_worktype", label: "仕入先別工事別工種毎" },
];

const WORK_TYPE_LABELS: Record<string, string> = {
  material: "材料費",
  labor: "労務費",
  subcontract: "外注費",
  expense: "経費",
};

function closingDayLabel(day: number): string {
  if (day === 99) return "月末";
  return `${day}日`;
}

function useVendorGroups() {
  return useQuery({
    queryKey: ["/api/vendor-groups"],
    queryFn: async () => {
      const res = await fetch("/api/vendor-groups");
      if (!res.ok) throw new Error("Failed to fetch vendor groups");
      return res.json() as Promise<{ items: VendorGroup[] }>;
    },
  });
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function firstDayOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split("T")[0];
}

/**
 * 仕入集計。
 *
 * 支払そのものは会計ソフト側で行うため、CMCは「仕入がいくら立っているか」を見る用途に絞る。
 * 締日の考え方は原価をどの期間で切るかにも必要なので、支払査定から引き継いでいる。
 * 会計ソフトへ渡した金額との検算にも使う画面のため、査定済みかどうかで行を落とさない。
 */
export default function PurchaseSummary() {
  const { toast } = useToast();

  const { data: groupsData } = useVendorGroups();
  const { data: vendors = [] } = useVendors<VendorItem>();
  const groups = groupsData?.items ?? [];

  const [startDate, setStartDate] = useState(firstDayOfMonth());
  const [endDate, setEndDate] = useState(today());
  const [groupId, setGroupId] = useState("");
  const [summaryType, setSummaryType] = useState("vendor");
  const [closingDay, setClosingDay] = useState("none");

  const [items, setItems] = useState<SummaryItem[]>([]);
  const [calculated, setCalculated] = useState(false);
  const [effectivePeriod, setEffectivePeriod] = useState<{ start: string; end: string } | null>(null);

  const vendorsInGroup = groupId
    ? vendors.filter((v) => v.groupId === Number(groupId))
    : [];

  const uniqueClosingDays = Array.from(new Set(vendorsInGroup.map((v) => v.closingDay)));
  const groupClosingDayHint: { value: number; uniform: boolean } | null =
    uniqueClosingDays.length === 1
      ? { value: uniqueClosingDays[0], uniform: true }
      : uniqueClosingDays.length > 1
      ? { value: uniqueClosingDays[0], uniform: false }
      : null;

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/payment-assessments/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          groupId: groupId || undefined,
          assessmentType: summaryType,
          closingDay: closingDay !== "none" ? Number(closingDay) : undefined,
          // 集計は「原価がいくら立ったか」を見るためのもの。過去に査定済みの伝票も必ず含める
          includeAssessed: true,
        }),
      });
      if (!res.ok) throw new Error("Failed to calculate");
      return res.json() as Promise<CalculateResponse>;
    },
    onSuccess: (data) => {
      setItems(data.items);
      setEffectivePeriod({ start: data.effectiveStart, end: data.effectiveEnd });
      setCalculated(true);
    },
    onError: () => {
      toast({ title: "エラー", description: "集計に失敗しました", variant: "destructive" });
    },
  });

  const resetCalculation = () => setCalculated(false);

  const totalGross = items.reduce((s, i) => s + i.totalAmount, 0);
  const vendorCount = new Set(items.map((i) => i.vendor)).size;

  const showProjectColumn = summaryType === "vendor_project" || summaryType === "vendor_project_worktype";
  const showWorkTypeColumn = summaryType === "vendor_project_worktype";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Calculator className="w-6 h-6 text-primary" />
            仕入集計
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            仕入データを仕入先・工事・工種で集計します。会計ソフトへ渡した金額との突き合わせにも使います。
          </p>
        </div>
      </div>

      {/* 条件設定パネル */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-700">条件設定</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs text-slate-600">対象期間（開始）</Label>
              <DateInput
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); resetCalculation(); }}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600">対象期間（終了）</Label>
              <DateInput
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); resetCalculation(); }}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600">
                締日
                {groupClosingDayHint != null && closingDay === "none" && (
                  <span className={`ml-2 text-xs ${groupClosingDayHint.uniform ? "text-blue-600" : "text-amber-600"}`}>
                    {groupClosingDayHint.uniform
                      ? `（グループ共通: ${closingDayLabel(groupClosingDayHint.value)}）`
                      : "（グループ内で締日が異なります）"}
                  </span>
                )}
              </Label>
              <Select
                value={closingDay}
                onValueChange={(v) => { setClosingDay(v); resetCalculation(); }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLOSING_DAY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {groupClosingDayHint != null && groupClosingDayHint.uniform && closingDay === "none" && (
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:underline mt-1"
                  onClick={() => setClosingDay(String(groupClosingDayHint!.value))}
                >
                  グループ共通締日を適用
                </button>
              )}
            </div>
            <div>
              <Label className="text-xs text-slate-600">仕入先グループ</Label>
              <Select
                value={groupId || "all"}
                onValueChange={(v) => { setGroupId(v === "all" ? "" : v); resetCalculation(); }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="全グループ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全グループ</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-600">集計方式</Label>
              <Select
                value={summaryType}
                onValueChange={(v) => { setSummaryType(v); resetCalculation(); }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUMMARY_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending}>
              {calculateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              集計実行
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 集計結果テーブル */}
      {calculated && (
        <>
          {effectivePeriod && effectivePeriod.start !== startDate && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>締日補正後の対象期間: {effectivePeriod.start} 〜 {effectivePeriod.end}</span>
            </div>
          )}

          {/* サマリー */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="border-none bg-slate-50">
              <CardHeader className="py-3 pb-1">
                <CardTitle className="text-xs text-slate-500 font-medium">仕入合計</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="text-xl font-bold">{formatCurrency(totalGross)}</div>
              </CardContent>
            </Card>
            <Card className="border-none bg-slate-50">
              <CardHeader className="py-3 pb-1">
                <CardTitle className="text-xs text-slate-500 font-medium">仕入先</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="text-xl font-bold">{vendorCount} 社</div>
              </CardContent>
            </Card>
            <Card className="border-none bg-slate-50">
              <CardHeader className="py-3 pb-1">
                <CardTitle className="text-xs text-slate-500 font-medium">集計行数</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="text-xl font-bold">{items.length} 件</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="border-b py-3">
              <CardTitle className="text-sm font-semibold text-slate-700">集計明細</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {items.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  指定期間に仕入データがありません
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 text-xs">
                        <TableHead>仕入先</TableHead>
                        {showProjectColumn && <TableHead>工事</TableHead>}
                        {showWorkTypeColumn && <TableHead>工種</TableHead>}
                        <TableHead className="text-right">仕入合計</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, idx) => (
                        <TableRow key={idx} className="hover:bg-slate-50/60">
                          <TableCell className="font-medium">{item.vendor}</TableCell>
                          {showProjectColumn && (
                            <TableCell className="text-sm">
                              <span className="font-mono text-xs text-slate-400 mr-1">{item.projectCode}</span>
                              {item.projectName}
                            </TableCell>
                          )}
                          {showWorkTypeColumn && (
                            <TableCell>
                              {item.workType ? (
                                <Badge variant="outline" className="text-xs">
                                  {WORK_TYPE_LABELS[item.workType] ?? item.workType}
                                </Badge>
                              ) : "—"}
                            </TableCell>
                          )}
                          <TableCell className="text-right font-mono text-sm font-semibold">
                            {formatCurrency(item.totalAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
