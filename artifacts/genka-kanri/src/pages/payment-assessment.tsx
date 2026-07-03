import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Calculator, CheckSquare, Loader2, RefreshCw, Info } from "lucide-react";
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

interface AssessmentItem {
  vendor: string;
  projectId: number;
  projectCode?: string;
  projectName?: string;
  workType?: string;
  totalAmount: number;
  holdAmount: number;
  payAmount: number;
  costItemIds: number[];
}

interface CalculateResponse {
  items: AssessmentItem[];
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

const ASSESSMENT_TYPE_OPTIONS = [
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

function buildAssessmentKey(
  startDate: string,
  endDate: string,
  groupId: string,
  assessmentType: string,
  closingDay: string
): string {
  return `${startDate}_${endDate}_${groupId || "all"}_${assessmentType}_${closingDay}`;
}

export default function PaymentAssessment() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: groupsData } = useVendorGroups();
  const { data: vendors = [] } = useVendors<VendorItem>();
  const groups = groupsData?.items ?? [];

  const [startDate, setStartDate] = useState(firstDayOfMonth());
  const [endDate, setEndDate] = useState(today());
  const [groupId, setGroupId] = useState("");
  const [assessmentType, setAssessmentType] = useState("vendor");
  const [closingDay, setClosingDay] = useState("none");
  const [dueDate, setDueDate] = useState("");
  const [includeAssessed, setIncludeAssessed] = useState(false);

  const [items, setItems] = useState<AssessmentItem[]>([]);
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
          assessmentType,
          closingDay: closingDay !== "none" ? Number(closingDay) : undefined,
          includeAssessed,
        }),
      });
      if (!res.ok) throw new Error("Failed to calculate");
      return res.json() as Promise<CalculateResponse>;
    },
    onSuccess: (data) => {
      setItems(data.items.map((item) => ({ ...item, holdAmount: 0, payAmount: item.totalAmount })));
      setEffectivePeriod({ start: data.effectiveStart, end: data.effectiveEnd });
      setCalculated(true);
    },
    onError: () => {
      toast({ title: "エラー", description: "集計に失敗しました", variant: "destructive" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const assessmentKey = buildAssessmentKey(startDate, endDate, groupId, assessmentType, closingDay);
      const res = await fetch("/api/payment-assessments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dueDate: dueDate || null,
          assessmentKey,
          assessmentType,
          items: items.filter((i) => i.payAmount > 0),
        }),
      });
      if (!res.ok) throw new Error("Failed to confirm");
      return res.json();
    },
    onSuccess: (data: { created: number; updated: number }) => {
      const msg = data.updated > 0
        ? `${data.created}件を新規生成、${data.updated}件を更新しました。`
        : `${data.created}件の支払データを生成しました。`;
      toast({ title: "査定確定", description: msg });
      setItems([]);
      setCalculated(false);
      setEffectivePeriod(null);
      qc.invalidateQueries({ queryKey: ["/api/payments"] });
    },
    onError: () => {
      toast({ title: "エラー", description: "確定処理に失敗しました", variant: "destructive" });
    },
  });

  const handleHoldChange = (index: number, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      // 保留金は仕入合計を超えられない（超えると保留金合計が破綻表示になる）。
      const hold = Math.min(next[index].totalAmount, Math.max(0, parseFloat(value) || 0));
      const pay = Math.max(0, next[index].totalAmount - hold);
      next[index] = { ...next[index], holdAmount: hold, payAmount: pay };
      return next;
    });
  };

  const resetCalculation = () => setCalculated(false);

  const totalPayAmount = items.reduce((s, i) => s + i.payAmount, 0);
  const totalHoldAmount = items.reduce((s, i) => s + i.holdAmount, 0);
  const totalGross = items.reduce((s, i) => s + i.totalAmount, 0);

  const showProjectColumn = assessmentType === "vendor_project" || assessmentType === "vendor_project_worktype";
  const showWorkTypeColumn = assessmentType === "vendor_project_worktype";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Calculator className="w-6 h-6 text-primary" />
            支払査定
          </h1>
          <p className="text-sm text-slate-500 mt-1">仕入データから支払金額を集計・査定します。</p>
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
              <Label className="text-xs text-slate-600">査定方式</Label>
              <Select
                value={assessmentType}
                onValueChange={(v) => { setAssessmentType(v); resetCalculation(); }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSESSMENT_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-600">支払期日（確定時）</Label>
              <DateInput
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <Button onClick={() => calculateMutation.mutate()} disabled={calculateMutation.isPending}>
              {calculateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              集計実行
            </Button>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeAssessed}
                onChange={(e) => setIncludeAssessed(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              査定済みも含める
              <span className="text-xs text-slate-400">（通常はOFF。訂正・再査定したい時だけON）</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 査定結果テーブル */}
      {calculated && (
        <>
          {effectivePeriod && effectivePeriod.start !== startDate && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>締日補正後の対象期間: {effectivePeriod.start} 〜 {effectivePeriod.end}</span>
            </div>
          )}

          {/* サマリー */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="border-none bg-slate-50">
              <CardHeader className="py-3 pb-1">
                <CardTitle className="text-xs text-slate-500 font-medium">仕入合計</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="text-xl font-bold">{formatCurrency(totalGross)}</div>
                <div className="text-xs text-slate-400 mt-0.5">{items.length} 件</div>
              </CardContent>
            </Card>
            <Card className="border-none bg-amber-50">
              <CardHeader className="py-3 pb-1">
                <CardTitle className="text-xs text-amber-600 font-medium">保留金合計</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="text-xl font-bold text-amber-700">{formatCurrency(totalHoldAmount)}</div>
              </CardContent>
            </Card>
            <Card className="border-none bg-emerald-50">
              <CardHeader className="py-3 pb-1">
                <CardTitle className="text-xs text-emerald-600 font-medium">支払金額合計</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="text-xl font-bold text-emerald-700">{formatCurrency(totalPayAmount)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="border-b py-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700">査定明細</CardTitle>
              <Button
                onClick={() => confirmMutation.mutate()}
                disabled={confirmMutation.isPending || items.filter((i) => i.payAmount > 0).length === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {confirmMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CheckSquare className="w-4 h-4 mr-2" />
                )}
                査定確定
              </Button>
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
                        <TableHead className="text-right w-36">保留金（円）</TableHead>
                        <TableHead className="text-right">支払金額</TableHead>
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
                          <TableCell className="text-right font-mono text-sm">
                            {formatCurrency(item.totalAmount)}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              max={item.totalAmount}
                              value={item.holdAmount || ""}
                              onChange={(e) => handleHoldChange(idx, e.target.value)}
                              placeholder="0"
                              className="h-8 text-sm text-right w-36"
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold text-emerald-700">
                            {formatCurrency(item.payAmount)}
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
