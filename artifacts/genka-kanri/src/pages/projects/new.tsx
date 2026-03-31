import { useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save } from "lucide-react";

const TAX_RATES = [0, 8, 10] as const;

const formSchema = z.object({
  projectCode: z.string().min(1, "工事番号は必須です"),
  name: z.string().min(1, "工事名称は必須です"),
  shortName: z.string().optional(),
  location: z.string().min(1, "工事場所は必須です"),
  clientName: z.string().min(1, "得意先は必須です"),
  orderType: z.string().optional(),
  overview: z.string().optional(),
  taxExcludedAmount: z.coerce.number().min(0).optional(),
  taxRate: z.coerce.number().optional(),
  taxAmount: z.coerce.number().optional(),
  taxIncludedAmount: z.coerce.number().optional(),
  description: z.string().optional(),
  department: z.string().optional(),
  salesStaff: z.string().optional(),
  siteManager: z.string().optional(),
  category1: z.string().optional(),
  category2: z.string().optional(),
  category3: z.string().optional(),
  orderDate: z.string().optional(),
  handoverDate: z.string().optional(),
  progressRate: z.coerce.number().min(0).max(100).optional(),
  estimateNumber: z.string().optional(),
  recognitionBasis: z.string().optional(),
  status: z.enum(["planning", "active", "completed", "suspended"]),
  startDate: z.string().min(1, "着工日は必須です"),
  endDate: z.string().min(1, "竣工予定日は必須です"),
  contractAmount: z.coerce.number().min(0, "請負金額は0以上である必要があります"),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewProject() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createProject = useCreateProject();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectCode: `P${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-`,
      name: "",
      shortName: "",
      location: "",
      clientName: "",
      orderType: "",
      overview: "",
      taxExcludedAmount: undefined,
      taxRate: 10,
      taxAmount: undefined,
      taxIncludedAmount: undefined,
      description: "",
      department: "",
      salesStaff: "",
      siteManager: "",
      category1: "",
      category2: "",
      category3: "",
      orderDate: "",
      handoverDate: "",
      progressRate: undefined,
      estimateNumber: "",
      recognitionBasis: "",
      status: "planning",
      startDate: new Date().toISOString().split("T")[0],
      endDate: "",
      contractAmount: 0,
    },
  });

  const taxExcludedAmount = form.watch("taxExcludedAmount");
  const taxRate = form.watch("taxRate");

  useEffect(() => {
    const excluded = taxExcludedAmount == null ? null : Number(taxExcludedAmount);
    const rate = taxRate == null ? null : Number(taxRate);
    if (excluded !== null && !isNaN(excluded) && rate !== null && !isNaN(rate)) {
      const tax = Math.floor(excluded * rate / 100);
      const included = excluded + tax;
      form.setValue("taxAmount", tax);
      form.setValue("taxIncludedAmount", included);
      form.setValue("contractAmount", included);
    }
  }, [taxExcludedAmount, taxRate]);

  function onSubmit(values: FormValues) {
    const normalizeStr = (v: string | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
    const normalizeDate = (v: string | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
    const normalizeNum = (v: number | undefined) => (v != null && !isNaN(v) ? v : undefined);

    const payload = {
      projectCode: values.projectCode,
      name: values.name,
      clientName: values.clientName,
      location: values.location,
      contractAmount: values.contractAmount,
      status: values.status,
      startDate: values.startDate,
      endDate: values.endDate,
      description: normalizeStr(values.description),
      shortName: normalizeStr(values.shortName),
      estimateNumber: normalizeStr(values.estimateNumber),
      orderType: normalizeStr(values.orderType),
      orderDate: normalizeDate(values.orderDate),
      taxRate: normalizeNum(values.taxRate),
      taxExcludedAmount: normalizeNum(values.taxExcludedAmount),
      taxAmount: normalizeNum(values.taxAmount),
      taxIncludedAmount: normalizeNum(values.taxIncludedAmount),
      overview: normalizeStr(values.overview),
      department: normalizeStr(values.department),
      salesStaff: normalizeStr(values.salesStaff),
      siteManager: normalizeStr(values.siteManager),
      category1: normalizeStr(values.category1),
      category2: normalizeStr(values.category2),
      category3: normalizeStr(values.category3),
      handoverDate: normalizeDate(values.handoverDate),
      progressRate: normalizeNum(values.progressRate),
      recognitionBasis: normalizeStr(values.recognitionBasis),
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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/projects"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">新規工事登録</h1>
          <p className="text-sm text-slate-500">新しい工事プロジェクトの情報を入力してください。</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* 工事番号・ステータス */}
          <Card>
            <CardHeader className="py-3 border-b bg-slate-50/60">
              <CardTitle className="text-sm font-semibold text-slate-700">管理情報</CardTitle>
            </CardHeader>
            <CardContent className="pt-5 grid grid-cols-1 md:grid-cols-3 gap-5">
              <FormField
                control={form.control}
                name="projectCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>工事番号 <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="例: P202401-001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="estimateNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>見積番号</FormLabel>
                    <FormControl>
                      <Input placeholder="例: Q202401-001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ステータス <span className="text-destructive">*</span></FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="planning">計画中</SelectItem>
                        <SelectItem value="active">施工中</SelectItem>
                        <SelectItem value="completed">完工</SelectItem>
                        <SelectItem value="suspended">中断</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* メイン2カラム */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ── 左カラム ── */}
            <Card>
              <CardHeader className="py-3 border-b bg-slate-50/60">
                <CardTitle className="text-sm font-semibold text-slate-700">工事基本情報</CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事名称 <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input placeholder="例: 〇〇ビル新築工事" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="shortName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事略称</FormLabel>
                      <FormControl>
                        <Input placeholder="例: 〇〇ビル" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事場所 <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input placeholder="例: 東京都新宿区..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>得意先 <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input placeholder="例: 株式会社〇〇" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="orderType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>受注区分</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="選択してください" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="元請">元請</SelectItem>
                          <SelectItem value="下請">下請</SelectItem>
                          <SelectItem value="直工事">直工事</SelectItem>
                          <SelectItem value="その他">その他</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="overview"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事概要</FormLabel>
                      <FormControl>
                        <Textarea placeholder="工事の概要を入力してください" rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 請負金額（税抜→税込自動計算） */}
                <div className="space-y-3 rounded-md border border-slate-200 p-4 bg-slate-50/50">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">請負金額</p>
                  <FormField
                    control={form.control}
                    name="taxExcludedAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>税抜金額（円）</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="0" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="taxRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>消費税率</FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(Number(v))}
                          value={String(field.value ?? 10)}
                        >
                          <FormControl>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {TAX_RATES.map((r) => (
                              <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="taxAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>消費税額（円）</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              readOnly
                              className="bg-slate-100 text-slate-600"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="taxIncludedAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>税込金額（円）</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              readOnly
                              className="bg-slate-100 font-semibold text-slate-800"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>備考</FormLabel>
                      <FormControl>
                        <Textarea placeholder="特記事項があれば入力してください" rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* ── 右カラム ── */}
            <Card>
              <CardHeader className="py-3 border-b bg-slate-50/60">
                <CardTitle className="text-sm font-semibold text-slate-700">担当・分類・工期</CardTitle>
              </CardHeader>
              <CardContent className="pt-5 space-y-4">
                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事部門</FormLabel>
                      <FormControl>
                        <Input placeholder="例: 建築部" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="salesStaff"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>営業担当</FormLabel>
                      <FormControl>
                        <Input placeholder="担当者名" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="siteManager"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>工事担当</FormLabel>
                      <FormControl>
                        <Input placeholder="担当者名" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 gap-3">
                  <FormField
                    control={form.control}
                    name="category1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>工事分類1</FormLabel>
                        <FormControl>
                          <Input placeholder="例: 新築" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="category2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>工事分類2</FormLabel>
                        <FormControl>
                          <Input placeholder="例: 木造" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="category3"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>工事分類3</FormLabel>
                        <FormControl>
                          <Input placeholder="例: 住宅" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-4 bg-slate-50/50">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">工期・日程</p>
                  <FormField
                    control={form.control}
                    name="orderDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>受注日</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>着工日 <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>竣工予定日 <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="handoverDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>引渡日（予定）</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="progressRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>進捗率（%）</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          placeholder="0〜100"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="recognitionBasis"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>計上基準</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="選択してください" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="完成基準">完成基準</SelectItem>
                          <SelectItem value="進行基準">進行基準</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end gap-4">
            <Button variant="outline" type="button" asChild>
              <Link href="/projects">キャンセル</Link>
            </Button>
            <Button type="submit" disabled={createProject.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {createProject.isPending ? "保存中..." : "工事を登録する"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
