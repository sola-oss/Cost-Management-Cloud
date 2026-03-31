import { useState } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetProject, useListBudgets, useCreateBudget, 
  getGetProjectQueryKey, getListBudgetsQueryKey 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_LABELS = {
  material: "材料費",
  labor: "労務費",
  subcontract: "外注費",
  expense: "経費",
};

const budgetSchema = z.object({
  category: z.enum(["material", "labor", "subcontract", "expense"]),
  description: z.string().min(1, "内訳名称は必須です"),
  budgetAmount: z.coerce.number().min(0, "予算金額は0以上である必要があります"),
});

export default function BudgetManagement() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0", 10);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: project } = useGetProject(projectId, { 
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } 
  });
  const { data: budgets, isLoading } = useListBudgets({ projectId }, { 
    query: { enabled: !!projectId, queryKey: getListBudgetsQueryKey({ projectId }) } 
  });
  
  const createBudget = useCreateBudget();

  const form = useForm<z.infer<typeof budgetSchema>>({
    resolver: zodResolver(budgetSchema),
    defaultValues: {
      category: "material",
      description: "",
      budgetAmount: 0,
    },
  });

  function onSubmit(values: z.infer<typeof budgetSchema>) {
    createBudget.mutate({ data: { projectId, ...values } }, {
      onSuccess: () => {
        toast({ title: "登録完了", description: "予算内訳を追加しました。" });
        queryClient.invalidateQueries({ queryKey: getListBudgetsQueryKey({ projectId }) });
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "summary"] });
        setOpen(false);
        form.reset();
      },
      onError: () => {
        toast({ title: "エラー", description: "予算の登録に失敗しました。", variant: "destructive" });
      }
    });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/projects/${projectId}`}><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">予算管理</h1>
            <p className="text-sm text-slate-500">
              {project ? project.name : "..."} の予算内訳と消化状況
            </p>
          </div>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              予算枠を追加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>予算枠の追加</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>区分</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="区分を選択" /></SelectTrigger>
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
                    <FormItem>
                      <FormLabel>内訳名称</FormLabel>
                      <FormControl>
                        <Input placeholder="例: 躯体工事費" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="budgetAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>予算金額</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
                  <Button type="submit" disabled={createBudget.isPending}>
                    {createBudget.isPending ? "保存中..." : "追加"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-slate-50 border-none">
          <CardHeader className="py-4"><CardTitle className="text-sm text-slate-500 font-medium">予算合計</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{budgets ? formatCurrency(budgets.totalBudget) : "..."}</div></CardContent>
        </Card>
        <Card className="bg-slate-50 border-none">
          <CardHeader className="py-4"><CardTitle className="text-sm text-slate-500 font-medium">実績合計</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{budgets ? formatCurrency(budgets.totalActual) : "..."}</div></CardContent>
        </Card>
        <Card className="bg-slate-50 border-none">
          <CardHeader className="py-4"><CardTitle className="text-sm text-slate-500 font-medium">残予算（差異）</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${budgets?.totalVariance && budgets.totalVariance < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
              {budgets ? formatCurrency(budgets.totalVariance) : "..."}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b py-4 bg-slate-50/50">
          <CardTitle className="text-base">予算内訳と消化状況</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">区分</TableHead>
                  <TableHead>内訳名称</TableHead>
                  <TableHead className="text-right">予算金額</TableHead>
                  <TableHead className="text-right">実績金額</TableHead>
                  <TableHead className="text-right">差異</TableHead>
                  <TableHead className="text-center w-[200px]">消化率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={6} className="h-12"><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                  ))
                ) : budgets?.items?.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="h-32 text-center text-slate-500">予算内訳が登録されていません</TableCell></TableRow>
                ) : (
                  budgets?.items.map(budget => (
                    <TableRow key={budget.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-medium text-slate-600">{CATEGORY_LABELS[budget.category as keyof typeof CATEGORY_LABELS]}</TableCell>
                      <TableCell className="font-medium">{budget.description}</TableCell>
                      <TableCell className="text-right text-blue-700 font-medium">{formatCurrency(budget.budgetAmount)}</TableCell>
                      <TableCell className="text-right text-orange-700 font-medium">{formatCurrency(budget.actualAmount)}</TableCell>
                      <TableCell className={`text-right font-medium ${budget.variance < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                        {formatCurrency(budget.variance)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress 
                            value={Math.min(budget.usageRate, 100)} 
                            className="h-2 flex-1" 
                            indicatorClassName={budget.usageRate > 100 ? "bg-destructive" : "bg-primary"} 
                          />
                          <span className={`text-xs font-medium w-10 text-right ${budget.usageRate > 100 ? 'text-destructive' : 'text-slate-600'}`}>
                            {budget.usageRate.toFixed(1)}%
                          </span>
                        </div>
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
