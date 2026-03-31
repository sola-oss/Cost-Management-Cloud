import { useState } from "react";
import { useListProjects, useCreateCostItem, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingCart, Save, Loader2, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_LABELS: Record<string, string> = {
  material: "材料費",
  labor: "労務費",
  subcontract: "外注費",
  expense: "経費",
};

const CATEGORY_COLORS: Record<string, string> = {
  material: "bg-blue-100 text-blue-700",
  labor: "bg-purple-100 text-purple-700",
  subcontract: "bg-orange-100 text-orange-700",
  expense: "bg-slate-100 text-slate-700",
};

const formSchema = z.object({
  projectId: z.coerce.number().min(1, "工事を選択してください"),
  category: z.enum(["material", "labor", "subcontract", "expense"]),
  incurredDate: z.string().min(1, "発生日は必須です"),
  description: z.string().min(1, "摘要は必須です"),
  vendor: z.string().optional(),
  quantity: z.coerce.number().optional().or(z.literal("")),
  unit: z.string().optional(),
  unitPrice: z.coerce.number().optional().or(z.literal("")),
  amount: z.coerce.number().min(0, "金額は0以上である必要があります"),
  invoiceNumber: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// 全工事の最近の仕入一覧を取得するカスタムフック
function useRecentCostItems() {
  return useQuery({
    queryKey: ["/api/cost-items/recent"],
    queryFn: async () => {
      const res = await fetch("/api/cost-items?limit=50");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{
        items: Array<{
          id: number;
          projectId: number;
          projectCode: string;
          projectName: string;
          category: string;
          description: string;
          vendor: string | null;
          amount: number;
          incurredDate: string;
          quantity: number | null;
          unit: string | null;
        }>;
        total: number;
        totalAmount: number;
      }>;
    },
  });
}

export default function Purchases() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const { data: projects } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });

  const { data: recentItems, isLoading: recentLoading, refetch } = useRecentCostItems();
  const createCostItem = useCreateCostItem();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId: 0,
      category: "material",
      incurredDate: new Date().toISOString().split("T")[0],
      description: "",
      vendor: "",
      quantity: "",
      unit: "",
      unitPrice: "",
      amount: 0,
      invoiceNumber: "",
      notes: "",
    },
  });

  const updateAmount = () => {
    const q = Number(form.getValues("quantity"));
    const u = Number(form.getValues("unitPrice"));
    if (!isNaN(q) && !isNaN(u) && q > 0 && u > 0) {
      form.setValue("amount", q * u);
    }
  };

  function onSubmit(values: FormValues) {
    const data = {
      projectId: values.projectId,
      category: values.category,
      incurredDate: values.incurredDate,
      description: values.description,
      vendor: values.vendor || undefined,
      quantity: values.quantity === "" ? undefined : Number(values.quantity),
      unit: values.unit || undefined,
      unitPrice: values.unitPrice === "" ? undefined : Number(values.unitPrice),
      amount: values.amount,
      invoiceNumber: values.invoiceNumber || undefined,
      notes: values.notes || undefined,
    };

    createCostItem.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "計上しました", description: "仕入明細を登録しました。" });
          queryClient.invalidateQueries({ queryKey: ["/api/cost-items/recent"] });
          queryClient.invalidateQueries({ queryKey: ["/api/cost-items"] });
          // Reset form except project and category
          const { projectId, category } = form.getValues();
          form.reset({
            projectId,
            category,
            incurredDate: new Date().toISOString().split("T")[0],
            description: "",
            vendor: "",
            quantity: "",
            unit: "",
            unitPrice: "",
            amount: 0,
            invoiceNumber: "",
            notes: "",
          });
          refetch();
        },
        onError: () => {
          toast({ title: "エラー", description: "登録に失敗しました。", variant: "destructive" });
        },
      },
    );
  }

  const filteredItems =
    filterCategory === "all"
      ? recentItems?.items ?? []
      : (recentItems?.items ?? []).filter((i) => i.category === filterCategory);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ヘッダー */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <ShoppingCart className="w-6 h-6 text-primary" />
          仕入入力
        </h1>
        <p className="text-sm text-slate-500 mt-1">各工事の材料・労務・外注・経費を計上します。</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* 入力フォーム */}
        <div className="xl:col-span-2">
          <Card>
            <CardHeader className="border-b py-4 bg-slate-50/50">
              <CardTitle className="text-base">原価明細入力</CardTitle>
              <CardDescription className="text-xs">工事を選択して仕入内容を入力してください</CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {/* 工事選択 */}
                  <FormField
                    control={form.control}
                    name="projectId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>工事選択 <span className="text-destructive">*</span></FormLabel>
                        <Select
                          onValueChange={(v) => field.onChange(Number(v))}
                          value={field.value ? String(field.value) : ""}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="工事を選択してください" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {projects?.items.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                <span className="font-mono text-xs text-slate-500 mr-2">{p.projectCode}</span>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    {/* 区分 */}
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>区分 <span className="text-destructive">*</span></FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="material">材料費</SelectItem>
                              <SelectItem value="labor">労務費</SelectItem>
                              <SelectItem value="subcontract">外注費</SelectItem>
                              <SelectItem value="expense">経費</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* 発生日 */}
                    <FormField
                      control={form.control}
                      name="incurredDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>発生日 <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* 摘要 */}
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>摘要 <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="例: 生コンクリート 21-18-20" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 取引先 */}
                  <FormField
                    control={form.control}
                    name="vendor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>取引先</FormLabel>
                        <FormControl>
                          <Input placeholder="例: 東京生コン株式会社" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 数量・単位・単価 */}
                  <div className="grid grid-cols-3 gap-2">
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>数量</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="0"
                              {...field}
                              onBlur={(e) => { field.onBlur(); updateAmount(); }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="unit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>単位</FormLabel>
                          <FormControl><Input placeholder="m3, 式" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="unitPrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>単価</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="0"
                              {...field}
                              onBlur={(e) => { field.onBlur(); updateAmount(); }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* 金額 */}
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>金額（円） <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="0" className="text-base font-bold" {...field} />
                        </FormControl>
                        <FormDescription className="text-xs">数量×単価で自動計算</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* 伝票番号 */}
                  <FormField
                    control={form.control}
                    name="invoiceNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>伝票番号</FormLabel>
                        <FormControl><Input placeholder="例: INV-2024-001" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button type="submit" className="w-full" disabled={createCostItem.isPending}>
                    {createCostItem.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    計上する
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* 最近の仕入一覧 */}
        <div className="xl:col-span-3">
          <Card>
            <CardHeader className="border-b py-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">最近の仕入明細</CardTitle>
                  <CardDescription className="text-xs">全工事の直近50件</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {/* カテゴリフィルタ */}
                  <div className="flex gap-1">
                    {["all", "material", "labor", "subcontract", "expense"].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setFilterCategory(cat)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          filterCategory === cat
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {cat === "all" ? "全て" : CATEGORY_LABELS[cat]}
                      </button>
                    ))}
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="w-[110px]">発生日</TableHead>
                      <TableHead>工事名</TableHead>
                      <TableHead className="w-[80px]">区分</TableHead>
                      <TableHead>摘要</TableHead>
                      <TableHead className="text-right font-bold">金額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentLoading ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={5}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : filteredItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-32 text-center text-slate-500">
                          仕入明細がありません
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredItems.map((item) => (
                        <TableRow key={item.id} className="hover:bg-slate-50/50">
                          <TableCell className="text-sm text-slate-600">
                            {new Date(item.incurredDate).toLocaleDateString("ja-JP")}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-medium truncate max-w-[160px]">{item.projectName}</div>
                            <div className="text-xs text-slate-400 font-mono">{item.projectCode}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`${CATEGORY_COLORS[item.category] ?? ""} text-xs`}>
                              {CATEGORY_LABELS[item.category] ?? item.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="font-medium truncate max-w-[160px]">{item.description}</div>
                            {item.vendor && (
                              <div className="text-xs text-slate-400">{item.vendor}</div>
                            )}
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
            {filteredItems.length > 0 && (
              <div className="border-t px-4 py-3 bg-slate-50/50 flex justify-between items-center">
                <span className="text-xs text-slate-500">{filteredItems.length} 件</span>
                <span className="text-sm font-bold text-slate-900">
                  合計 {formatCurrency(filteredItems.reduce((s, i) => s + i.amount, 0))}
                </span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
