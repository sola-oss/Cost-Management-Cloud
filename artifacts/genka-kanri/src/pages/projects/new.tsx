import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation, Link } from "wouter";
import { useCreateProject } from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Info } from "lucide-react";

type ContractLineLocal = { contractDate: string; taxExcluded: string };

const EMPTY_LINES: ContractLineLocal[] = Array.from({ length: 8 }, () => ({
  contractDate: "",
  taxExcluded: "",
}));

const formSchema = z.object({
  projectCodeMain: z.string().min(1, "工事番号は必須です"),
  projectCodeBranch: z.string().default("00"),
  name: z.string().min(1, "工事名称は必須です"),
  shortName: z.string().optional(),
  location: z.string().min(1, "工事場所は必須です"),
  clientName: z.string().min(1, "得意先は必須です"),
  orderType: z.string().optional(),
  floorAreaTsubo: z.coerce.number().optional(),
  floorAreaSqm: z.coerce.number().optional(),
  overview: z.string().optional(),
  description: z.string().optional(),
  memo: z.string().optional(),
  department: z.string().optional(),
  salesStaff: z.string().optional(),
  siteManager: z.string().optional(),
  category1: z.string().optional(),
  category2: z.string().optional(),
  category3: z.string().optional(),
  orderDate: z.string().optional(),
  estimateNumber: z.string().optional(),
  startDate: z.string().min(1, "着工日は必須です"),
  startDateActual: z.string().optional(),
  endDate: z.string().min(1, "竣工予定日は必須です"),
  endDateActual: z.string().optional(),
  handoverDate: z.string().optional(),
  handoverDateActual: z.string().optional(),
  progressRate: z.coerce.number().min(0).max(100).optional(),
  isCompleted: z.boolean().default(false),
  recognitionBasis: z.string().optional(),
  status: z.enum(["planning", "active", "completed", "suspended"]),
});

type FormValues = z.infer<typeof formSchema>;

function fmt(n: number): string {
  if (n === 0) return "";
  return n.toLocaleString("ja-JP");
}

function parseLine(l: ContractLineLocal) {
  const excluded = parseFloat(l.taxExcluded.replace(/,/g, "")) || 0;
  const tax = Math.floor(excluded * 0.1);
  const included = excluded + tax;
  return { excluded, tax, included };
}

export default function NewProject() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createProject = useCreateProject();

  const [contractLines, setContractLines] = useState<ContractLineLocal[]>(EMPTY_LINES);
  const [showClientDetail, setShowClientDetail] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectCodeMain: `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}0001`,
      projectCodeBranch: "00",
      name: "",
      shortName: "",
      location: "",
      clientName: "",
      orderType: "",
      floorAreaTsubo: undefined,
      floorAreaSqm: undefined,
      overview: "",
      description: "",
      memo: "",
      department: "",
      salesStaff: "",
      siteManager: "",
      category1: "",
      category2: "",
      category3: "",
      orderDate: new Date().toISOString().split("T")[0],
      estimateNumber: "",
      startDate: new Date().toISOString().split("T")[0],
      startDateActual: "",
      endDate: "",
      endDateActual: "",
      handoverDate: "",
      handoverDateActual: "",
      progressRate: undefined,
      isCompleted: false,
      recognitionBasis: "",
      status: "planning",
    },
  });

  const lineCalcs = useMemo(() => contractLines.map(parseLine), [contractLines]);
  const totalExcluded = lineCalcs.reduce((s, l) => s + l.excluded, 0);
  const totalTax = lineCalcs.reduce((s, l) => s + l.tax, 0);
  const totalIncluded = lineCalcs.reduce((s, l) => s + l.included, 0);

  function updateLine(index: number, field: keyof ContractLineLocal, value: string) {
    setContractLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function handleAutoCalc() {
    const rate = form.getValues("progressRate");
    if (rate === undefined || isNaN(Number(rate))) return;
    if (Number(rate) >= 100) {
      form.setValue("isCompleted", true);
      form.setValue("status", "completed");
    }
  }

  function onSubmit(values: FormValues) {
    const ns = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
    const nd = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
    const nn = (v: number | undefined) => (v != null && !isNaN(v) ? v : undefined);

    const projectCode = `${values.projectCodeMain}-${values.projectCodeBranch}`;

    const filledLines = contractLines.filter((l) => l.taxExcluded.trim() !== "").map((l) => ({
      contractDate: l.contractDate || null,
      taxExcludedAmount: parseFloat(l.taxExcluded.replace(/,/g, "")) || null,
    }));

    const contractAmount = totalIncluded || 0;
    const taxExcludedAmount = totalExcluded || undefined;
    const taxAmountVal = totalTax || undefined;
    const taxIncludedAmount = totalIncluded || undefined;

    const payload = {
      projectCode,
      name: values.name,
      clientName: values.clientName,
      location: values.location,
      contractAmount,
      status: values.status,
      startDate: values.startDate,
      endDate: values.endDate,
      description: ns(values.description),
      shortName: ns(values.shortName),
      estimateNumber: ns(values.estimateNumber),
      orderType: ns(values.orderType),
      orderDate: nd(values.orderDate),
      taxRate: 10,
      taxExcludedAmount: nn(taxExcludedAmount),
      taxAmount: nn(taxAmountVal),
      taxIncludedAmount: nn(taxIncludedAmount),
      overview: ns(values.overview),
      department: ns(values.department),
      salesStaff: ns(values.salesStaff),
      siteManager: ns(values.siteManager),
      category1: ns(values.category1),
      category2: ns(values.category2),
      category3: ns(values.category3),
      handoverDate: nd(values.handoverDate),
      progressRate: nn(values.progressRate),
      recognitionBasis: ns(values.recognitionBasis),
      projectCodeBranch: values.projectCodeBranch,
      startDateActual: nd(values.startDateActual),
      endDateActual: nd(values.endDateActual),
      handoverDateActual: nd(values.handoverDateActual),
      floorAreaTsubo: nn(values.floorAreaTsubo),
      floorAreaSqm: nn(values.floorAreaSqm),
      memo: ns(values.memo),
      isCompleted: values.isCompleted,
      contractLines: filledLines.length > 0 ? filledLines : undefined,
    };

    createProject.mutate({ data: payload }, {
      onSuccess: (data) => {
        toast({ title: "登録完了", description: "新規工事を登録しました。" });
        setLocation(`/projects/${data.id}`);
      },
      onError: () => {
        toast({ title: "エラー", description: "工事の登録に失敗しました。", variant: "destructive" });
      },
    });
  }

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" asChild>
          <Link href="/projects"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <h1 className="text-xl font-bold text-slate-900">工事登録【新規】</h1>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

          {/* ── 管理情報ヘッダー行 ── */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex gap-3 items-start">

                {/* 工事コード + 枝番（グループ） */}
                <div className="flex gap-1 items-start flex-[2] min-w-0">
                  <div className="flex-1 min-w-0">
                    <FormField
                      control={form.control}
                      name="projectCodeMain"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-slate-600">工事コード</FormLabel>
                          <FormControl>
                            <Input className="w-full text-sm" placeholder="2025100100" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <span className="pt-5 text-slate-400 font-medium shrink-0">—</span>
                  <div className="w-16 shrink-0">
                    <FormField
                      control={form.control}
                      name="projectCodeBranch"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-slate-600">枝番</FormLabel>
                          <FormControl>
                            <Input className="w-full text-sm text-center" placeholder="00" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* 受注日 */}
                <div className="flex-1 min-w-0">
                  <FormField
                    control={form.control}
                    name="orderDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">受注日</FormLabel>
                        <FormControl>
                          <Input type="date" className="w-full text-sm" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {/* 見積番号 */}
                <div className="flex-1 min-w-0">
                  <FormField
                    control={form.control}
                    name="estimateNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">見積番号</FormLabel>
                        <FormControl>
                          <Input className="w-full text-sm" placeholder="2025100100-00" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {/* ステータス */}
                <div className="flex-1 min-w-0">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">ステータス</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="w-full text-sm"><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="planning">計画中</SelectItem>
                            <SelectItem value="active">施工中</SelectItem>
                            <SelectItem value="completed">完工</SelectItem>
                            <SelectItem value="suspended">中断</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>

              </div>
            </CardContent>
          </Card>

          {/* ── メイン 2カラム（左60% / 右40%） ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

            {/* ── 左カラム (3/5 = 60%) ── */}
            <div className="space-y-4 lg:col-span-3">
              <Card>
                <CardHeader className="py-2 px-4 border-b bg-teal-700">
                  <CardTitle className="text-xs font-semibold text-white">工事基本情報</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  {/* 工事名称 */}
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">工事名称 <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder="例: 〇〇邸　新築工事" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 工事略称 */}
                  <FormField
                    control={form.control}
                    name="shortName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">工事略称</FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder="例: 〇〇邸　新築" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {/* 工事場所 */}
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">工事場所 <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder="例: 宮城県仙台市青葉区1−2−1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 得意先 + 詳細ボタン */}
                  <FormField
                    control={form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">得意先 <span className="text-destructive">*</span></FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input className="text-sm flex-1" placeholder="例: エステート住建" {...field} />
                          </FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-xs"
                            onClick={() => setShowClientDetail(true)}
                          >
                            詳細
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 受注区分 + 坪 + ㎡ */}
                  <div className="flex gap-2 items-end">
                    <FormField
                      control={form.control}
                      name="orderType"
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormLabel className="text-xs text-slate-600">受注区分</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger className="text-sm"><SelectValue placeholder="選択" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="元請">元請</SelectItem>
                              <SelectItem value="下請">下請</SelectItem>
                              <SelectItem value="直工事">直工事</SelectItem>
                              <SelectItem value="その他">その他</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="floorAreaTsubo"
                      render={({ field }) => (
                        <FormItem className="w-24">
                          <FormLabel className="text-xs text-slate-600">坪</FormLabel>
                          <FormControl>
                            <Input type="number" className="text-sm" placeholder="0.0" {...field} value={field.value ?? ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="floorAreaSqm"
                      render={({ field }) => (
                        <FormItem className="w-24">
                          <FormLabel className="text-xs text-slate-600">㎡</FormLabel>
                          <FormControl>
                            <Input type="number" className="text-sm" placeholder="0.0" {...field} value={field.value ?? ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* 工事概要 */}
                  <FormField
                    control={form.control}
                    name="overview"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">工事概要</FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder="工事概要を入力" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* ── 請負金額テーブル ── */}
              <Card>
                <CardHeader className="py-2 px-4 border-b bg-teal-700">
                  <CardTitle className="text-xs font-semibold text-white">請負金額</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-teal-600 text-white">
                          <th className="border border-teal-500 px-2 py-1.5 text-center w-8">No</th>
                          <th className="border border-teal-500 px-2 py-1.5 text-center w-32">契約日付</th>
                          <th className="border border-teal-500 px-2 py-1.5 text-right w-28">税抜金額</th>
                          <th className="border border-teal-500 px-2 py-1.5 text-right w-24">消費税<br />10%</th>
                          <th className="border border-teal-500 px-2 py-1.5 text-right w-28">税込金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contractLines.map((line, i) => {
                          const calc = lineCalcs[i];
                          return (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="border border-slate-200 px-2 py-0.5 text-center text-slate-500">{i + 1}</td>
                              <td className="border border-slate-200 px-1 py-0.5">
                                <input
                                  type="date"
                                  value={line.contractDate}
                                  onChange={(e) => updateLine(i, "contractDate", e.target.value)}
                                  className="w-full text-xs border-none outline-none bg-transparent"
                                />
                              </td>
                              <td className="border border-slate-200 px-1 py-0.5">
                                <input
                                  type="text"
                                  value={line.taxExcluded}
                                  onChange={(e) => updateLine(i, "taxExcluded", e.target.value)}
                                  className="w-full text-xs text-right border-none outline-none bg-transparent"
                                  placeholder="0"
                                />
                              </td>
                              <td className="border border-slate-200 px-2 py-0.5 text-right text-slate-500 bg-slate-50/50">
                                {calc.tax > 0 ? calc.tax.toLocaleString("ja-JP") : ""}
                              </td>
                              <td className="border border-slate-200 px-2 py-0.5 text-right font-medium text-slate-700 bg-slate-50/50">
                                {calc.included > 0 ? calc.included.toLocaleString("ja-JP") : ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-teal-50 font-semibold">
                          <td colSpan={2} className="border border-slate-200 px-2 py-1.5 text-center text-xs text-slate-700">合計金額</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right text-xs">
                            {totalExcluded > 0 ? totalExcluded.toLocaleString("ja-JP") : ""}
                          </td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right text-xs">
                            {totalTax > 0 ? totalTax.toLocaleString("ja-JP") : ""}
                          </td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right text-xs font-bold text-teal-700">
                            {totalIncluded > 0 ? totalIncluded.toLocaleString("ja-JP") : ""}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>

            </div>

            {/* ── 右カラム (2/5 = 40%) ── */}
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader className="py-2 px-4 border-b bg-teal-700">
                  <CardTitle className="text-xs font-semibold text-white">担当・分類</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">工事部門</FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder="例: 本社建築一課" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="salesStaff"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">営業担当</FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder="担当者名" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="siteManager"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">工事担当</FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder="担当者名" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <FormField
                      control={form.control}
                      name="category1"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-slate-600">工事分類1</FormLabel>
                          <FormControl>
                            <Input className="text-sm" placeholder="例: 民間" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="category2"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-slate-600">工事分類2</FormLabel>
                          <FormControl>
                            <Input className="text-sm" placeholder="例: 建築" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="category3"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-slate-600">工事分類3</FormLabel>
                          <FormControl>
                            <Input className="text-sm" placeholder="例: 新規" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* 工事日程（予定/実施） */}
              <Card>
                <CardHeader className="py-2 px-4 border-b bg-teal-700">
                  <CardTitle className="text-xs font-semibold text-white">工事日程</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-teal-600 text-white">
                        <th className="border border-teal-500 px-3 py-1.5 text-left w-16">区分</th>
                        <th className="border border-teal-500 px-3 py-1.5 text-center">予定</th>
                        <th className="border border-teal-500 px-3 py-1.5 text-center">実施</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* 着工日 */}
                      <tr className="hover:bg-slate-50">
                        <td className="border border-slate-200 px-3 py-1 font-medium text-slate-700 bg-teal-50/50 whitespace-nowrap">着工日</td>
                        <td className="border border-slate-200 px-1 py-0.5">
                          <FormField
                            control={form.control}
                            name="startDate"
                            render={({ field }) => (
                              <FormItem className="m-0 p-0">
                                <FormControl>
                                  <input
                                    type="date"
                                    {...field}
                                    className="w-full text-xs border-none outline-none bg-transparent py-1"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </td>
                        <td className="border border-slate-200 px-1 py-0.5">
                          <FormField
                            control={form.control}
                            name="startDateActual"
                            render={({ field }) => (
                              <FormItem className="m-0 p-0">
                                <FormControl>
                                  <input
                                    type="date"
                                    {...field}
                                    className="w-full text-xs border-none outline-none bg-transparent py-1"
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </td>
                      </tr>
                      {/* 竣工日 */}
                      <tr className="hover:bg-slate-50">
                        <td className="border border-slate-200 px-3 py-1 font-medium text-slate-700 bg-teal-50/50 whitespace-nowrap">竣工日</td>
                        <td className="border border-slate-200 px-1 py-0.5">
                          <FormField
                            control={form.control}
                            name="endDate"
                            render={({ field }) => (
                              <FormItem className="m-0 p-0">
                                <FormControl>
                                  <input
                                    type="date"
                                    {...field}
                                    className="w-full text-xs border-none outline-none bg-transparent py-1"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </td>
                        <td className="border border-slate-200 px-1 py-0.5">
                          <FormField
                            control={form.control}
                            name="endDateActual"
                            render={({ field }) => (
                              <FormItem className="m-0 p-0">
                                <FormControl>
                                  <input
                                    type="date"
                                    {...field}
                                    className="w-full text-xs border-none outline-none bg-transparent py-1"
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </td>
                      </tr>
                      {/* 引渡日 */}
                      <tr className="hover:bg-slate-50">
                        <td className="border border-slate-200 px-3 py-1 font-medium text-slate-700 bg-teal-50/50 whitespace-nowrap">引渡日</td>
                        <td className="border border-slate-200 px-1 py-0.5">
                          <FormField
                            control={form.control}
                            name="handoverDate"
                            render={({ field }) => (
                              <FormItem className="m-0 p-0">
                                <FormControl>
                                  <input
                                    type="date"
                                    {...field}
                                    className="w-full text-xs border-none outline-none bg-transparent py-1"
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </td>
                        <td className="border border-slate-200 px-1 py-0.5">
                          <FormField
                            control={form.control}
                            name="handoverDateActual"
                            render={({ field }) => (
                              <FormItem className="m-0 p-0">
                                <FormControl>
                                  <input
                                    type="date"
                                    {...field}
                                    className="w-full text-xs border-none outline-none bg-transparent py-1"
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* 進捗 */}
              <Card>
                <CardHeader className="py-2 px-4 border-b bg-teal-700">
                  <CardTitle className="text-xs font-semibold text-white">進捗</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  <FormField
                    control={form.control}
                    name="recognitionBasis"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-slate-600">計上基準</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger className="text-sm"><SelectValue placeholder="選択してください" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="完成基準">完成基準</SelectItem>
                            <SelectItem value="進行基準">進行基準</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  {/* 進捗率 + 完成チェック */}
                  <div className="space-y-2">
                    <p className="text-xs text-slate-600">進捗率</p>
                    <div className="flex items-center gap-3">
                      <FormField
                        control={form.control}
                        name="progressRate"
                        render={({ field }) => (
                          <FormItem className="m-0">
                            <FormControl>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  className="w-16 text-sm text-right"
                                  placeholder="0"
                                  {...field}
                                  value={field.value ?? ""}
                                />
                                <span className="text-sm text-slate-600">%</span>
                              </div>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="isCompleted"
                        render={({ field }) => (
                          <FormItem className="m-0 flex items-center gap-2">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={(checked) => {
                                  field.onChange(checked);
                                  if (checked) {
                                    form.setValue("progressRate", 100);
                                    form.setValue("status", "completed");
                                  }
                                }}
                              />
                            </FormControl>
                            <FormLabel className="text-xs text-slate-600 cursor-pointer">完成</FormLabel>
                          </FormItem>
                        )}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={handleAutoCalc}
                    >
                      自動計算
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── 備考・メモ（全幅） ── */}
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-600">備考</FormLabel>
                      <FormControl>
                        <Input className="text-sm" placeholder="特記事項があれば入力" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="memo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-slate-600">メモ</FormLabel>
                      <FormControl>
                        <Textarea className="text-sm" rows={2} placeholder="自由記入メモ" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── 登録ボタン ── */}
          <div className="flex justify-end gap-3 pb-4">
            <Button variant="outline" type="button" asChild>
              <Link href="/projects">キャンセル</Link>
            </Button>
            <Button type="submit" disabled={createProject.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {createProject.isPending ? "保存中..." : "F12 登録"}
            </Button>
          </div>
        </form>
      </Form>

      {/* 得意先詳細モーダル（簡易） */}
      {showClientDetail && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowClientDetail(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-5 h-5 text-teal-600" />
              <h3 className="font-semibold text-slate-800">得意先詳細</h3>
            </div>
            <p className="text-sm text-slate-600">得意先マスタは今後実装予定です。<br />現在は得意先名を直接入力してください。</p>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => setShowClientDetail(false)}>閉じる</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
