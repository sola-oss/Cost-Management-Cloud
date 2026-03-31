import { useParams, Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateCostItem, useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const formSchema = z.object({
  category: z.enum(["material", "labor", "subcontract", "expense"]),
  description: z.string().min(1, "摘要は必須です"),
  vendor: z.string().optional(),
  quantity: z.coerce.number().optional().or(z.literal('')),
  unit: z.string().optional(),
  unitPrice: z.coerce.number().optional().or(z.literal('')),
  amount: z.coerce.number().min(0, "金額は0以上である必要があります"),
  incurredDate: z.string().min(1, "発生日は必須です"),
  invoiceNumber: z.string().optional(),
  notes: z.string().optional(),
});

export default function NewCostEntry() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCostItem = useCreateCostItem();

  const { data: project } = useGetProject(projectId, { 
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } 
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: "material",
      description: "",
      vendor: "",
      quantity: "",
      unit: "",
      unitPrice: "",
      amount: 0,
      incurredDate: new Date().toISOString().split('T')[0],
      invoiceNumber: "",
      notes: "",
    },
  });

  // Automatically calculate amount if quantity and unitPrice are provided
  const watchQuantity = form.watch("quantity");
  const watchUnitPrice = form.watch("unitPrice");

  // Only update amount if both exist and are numbers
  const updateAmount = () => {
    const q = Number(form.getValues("quantity"));
    const u = Number(form.getValues("unitPrice"));
    if (!isNaN(q) && !isNaN(u) && q > 0 && u > 0) {
      form.setValue("amount", q * u);
    }
  };

  function onSubmit(values: z.infer<typeof formSchema>) {
    // Clean up empty strings back to undefined for the API
    const data = {
      projectId,
      ...values,
      quantity: values.quantity === '' ? undefined : Number(values.quantity),
      unitPrice: values.unitPrice === '' ? undefined : Number(values.unitPrice),
    };

    createCostItem.mutate({ data }, {
      onSuccess: () => {
        toast({ title: "登録完了", description: "原価明細を登録しました。" });
        queryClient.invalidateQueries({ queryKey: ["/api/cost-items"] });
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "summary"] });
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "budget-vs-actual"] });
        setLocation(`/projects/${projectId}`);
      },
      onError: () => {
        toast({ title: "エラー", description: "原価の登録に失敗しました。", variant: "destructive" });
      }
    });
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href={`/projects/${projectId}`}><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">原価入力</h1>
          <p className="text-sm text-slate-500">
            {project ? `${project.name} の原価を計上します` : "読み込み中..."}
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>明細情報</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="incurredDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>発生日 <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>区分 <span className="text-destructive">*</span></FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="区分を選択" />
                        </SelectTrigger>
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

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>摘要 <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="例: 生コンクリート 21-18-20" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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

              <FormField
                control={form.control}
                name="invoiceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>伝票番号</FormLabel>
                    <FormControl>
                      <Input placeholder="例: INV-2024-001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>金額情報</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>数量</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} onBlur={(e) => { field.onBlur(); updateAmount(); }} />
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
                    <FormControl>
                      <Input placeholder="m3, 式, 人工" {...field} />
                    </FormControl>
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
                      <Input type="number" placeholder="0" {...field} onBlur={(e) => { field.onBlur(); updateAmount(); }} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem className="md:col-span-3">
                    <FormLabel>金額（円） <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" className="text-lg font-bold" {...field} />
                    </FormControl>
                    <FormDescription>数量と単価を入力すると自動計算されます</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>備考</FormLabel>
                    <FormControl>
                      <Textarea placeholder="特記事項があれば入力" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button variant="outline" type="button" asChild>
              <Link href={`/projects/${projectId}`}>キャンセル</Link>
            </Button>
            <Button type="submit" disabled={createCostItem.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {createCostItem.isPending ? "保存中..." : "計上する"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
