import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const formSchema = z.object({
  constructionName: z.string().optional(),
  location: z.string().optional(),
  clientName: z.string().optional(),
  contractAmount: z.coerce.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  constructionType: z.string().optional(),
  contractType: z.string().optional(),
  primeContractorName: z.string().optional(),
  engineer1Category: z.string().optional(),
  engineer1Name: z.string().optional(),
  engineer1Qualification: z.string().optional(),
  engineer1LicenseNumber: z.string().optional(),
  specialist1WorkContent: z.string().optional(),
  specialist1Name: z.string().optional(),
  specialist1Qualification: z.string().optional(),
  remarks: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface ProjectData {
  id: number;
  name: string;
  location: string;
  clientName: string;
  contractAmount: number;
  startDate: string;
  endDate: string;
}

interface HistoryData {
  id: number;
  projectId: number;
  constructionName: string | null;
  location: string | null;
  clientName: string | null;
  contractAmount: number | null;
  startDate: string | null;
  endDate: string | null;
  constructionType: string | null;
  contractType: string | null;
  primeContractorName: string | null;
  engineer1Category: string | null;
  engineer1Name: string | null;
  engineer1Qualification: string | null;
  engineer1LicenseNumber: string | null;
  specialist1WorkContent: string | null;
  specialist1Name: string | null;
  specialist1Qualification: string | null;
  remarks: string | null;
}

export default function ConstructionHistory() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState(false);

  const projectQuery = useQuery<ProjectData>({
    queryKey: [`/api/projects/${id}`],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/projects/${id}`);
      if (!res.ok) throw new Error("工事データの取得に失敗しました");
      return res.json();
    },
  });

  const historyQuery = useQuery<HistoryData>({
    queryKey: [`/api/projects/${id}/construction-history`],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/projects/${id}/construction-history`);
      if (res.status === 404) return null as unknown as HistoryData;
      if (!res.ok) throw new Error("工事経歴書の取得に失敗しました");
      return res.json();
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      constructionName: "",
      location: "",
      clientName: "",
      contractAmount: undefined,
      startDate: "",
      endDate: "",
      constructionType: "",
      contractType: "",
      primeContractorName: "",
      engineer1Category: "",
      engineer1Name: "",
      engineer1Qualification: "",
      engineer1LicenseNumber: "",
      specialist1WorkContent: "",
      specialist1Name: "",
      specialist1Qualification: "",
      remarks: "",
    },
  });

  useEffect(() => {
    if (loaded) return;
    const project = projectQuery.data;
    const history = historyQuery.data;

    if (!project || historyQuery.isLoading) return;

    setLoaded(true);

    if (history) {
      form.reset({
        constructionName: history.constructionName ?? project.name,
        location: history.location ?? project.location,
        clientName: history.clientName ?? project.clientName,
        contractAmount: history.contractAmount ?? project.contractAmount,
        startDate: history.startDate ?? project.startDate,
        endDate: history.endDate ?? project.endDate,
        constructionType: history.constructionType ?? "",
        contractType: history.contractType ?? "",
        primeContractorName: history.primeContractorName ?? "",
        engineer1Category: history.engineer1Category ?? "",
        engineer1Name: history.engineer1Name ?? "",
        engineer1Qualification: history.engineer1Qualification ?? "",
        engineer1LicenseNumber: history.engineer1LicenseNumber ?? "",
        specialist1WorkContent: history.specialist1WorkContent ?? "",
        specialist1Name: history.specialist1Name ?? "",
        specialist1Qualification: history.specialist1Qualification ?? "",
        remarks: history.remarks ?? "",
      });
    } else {
      form.reset({
        constructionName: project.name,
        location: project.location,
        clientName: project.clientName,
        contractAmount: project.contractAmount,
        startDate: project.startDate,
        endDate: project.endDate,
        constructionType: "",
        contractType: "",
        primeContractorName: "",
        engineer1Category: "",
        engineer1Name: "",
        engineer1Qualification: "",
        engineer1LicenseNumber: "",
        specialist1WorkContent: "",
        specialist1Name: "",
        specialist1Qualification: "",
        remarks: "",
      });
    }
  }, [projectQuery.data, historyQuery.data, historyQuery.isLoading, loaded]);

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await fetch(`${BASE}/api/projects/${id}/construction-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error("保存に失敗しました");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${id}/construction-history`] });
      toast({ title: "保存しました", description: "工事経歴書を保存しました" });
    },
    onError: () => {
      toast({ title: "エラー", description: "保存に失敗しました", variant: "destructive" });
    },
  });

  function onSubmit(values: FormValues) {
    saveMutation.mutate(values);
  }

  const isLoading = projectQuery.isLoading || historyQuery.isLoading;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (projectQuery.isError) {
    return (
      <div className="p-6 text-red-600">工事データの取得に失敗しました</div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Link href={`/projects/${id}`}>
          <Button variant="ghost" size="sm" className="gap-1 text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" />
            工事詳細へ戻る
          </Button>
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">工事経歴書</h1>
        {projectQuery.data && (
          <span className="text-sm text-slate-500">{projectQuery.data.name}</span>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* 基本情報 */}
          <Card>
            <CardHeader className="py-2 px-4 border-b bg-teal-700">
              <CardTitle className="text-xs font-semibold text-white">基本情報</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="constructionName"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel className="text-xs text-slate-600">工事名称</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="工事名称" {...field} value={field.value ?? ""} />
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
                    <FormLabel className="text-xs text-slate-600">工事場所</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="工事場所" {...field} value={field.value ?? ""} />
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
                    <FormLabel className="text-xs text-slate-600">注文者</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="注文者名" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contractAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">請負金額（円）</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        className="text-sm"
                        placeholder="0"
                        {...field}
                        value={field.value ?? ""}
                        onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                      />
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
                    <FormLabel className="text-xs text-slate-600">工期（開始）</FormLabel>
                    <FormControl>
                      <Input type="date" className="text-sm" {...field} value={field.value ?? ""} />
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
                    <FormLabel className="text-xs text-slate-600">工期（終了）</FormLabel>
                    <FormControl>
                      <Input type="date" className="text-sm" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* 工事区分 */}
          <Card>
            <CardHeader className="py-2 px-4 border-b bg-teal-700">
              <CardTitle className="text-xs font-semibold text-white">工事区分</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="constructionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">工事の種別</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="例：建築一式工事" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contractType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">元請／下請の別</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder="選択してください" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="元請">元請</SelectItem>
                        <SelectItem value="下請">下請</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="primeContractorName"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel className="text-xs text-slate-600">元請業者名（下請の場合）</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="元請業者名" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* 配置技術者 */}
          <Card>
            <CardHeader className="py-2 px-4 border-b bg-teal-700">
              <CardTitle className="text-xs font-semibold text-white">配置技術者</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="engineer1Category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">区分</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder="選択してください" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="監理技術者">監理技術者</SelectItem>
                        <SelectItem value="主任技術者">主任技術者</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="engineer1Name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">氏名</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="氏名" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="engineer1Qualification"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">資格</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="例：一級建築士" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="engineer1LicenseNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">資格者証番号</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="資格者証番号" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* 専門技術者 */}
          <Card>
            <CardHeader className="py-2 px-4 border-b bg-teal-700">
              <CardTitle className="text-xs font-semibold text-white">専門技術者</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="specialist1WorkContent"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel className="text-xs text-slate-600">担当工事内容</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="担当工事内容" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="specialist1Name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">氏名</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="氏名" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="specialist1Qualification"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">資格</FormLabel>
                    <FormControl>
                      <Input className="text-sm" placeholder="例：一級建築施工管理技士" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* 施工内容・備考 */}
          <Card>
            <CardHeader className="py-2 px-4 border-b bg-teal-700">
              <CardTitle className="text-xs font-semibold text-white">施工内容・備考</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <FormField
                control={form.control}
                name="remarks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-600">施工内容・備考</FormLabel>
                    <FormControl>
                      <Textarea
                        className="text-sm"
                        rows={5}
                        placeholder="施工内容、特記事項などを自由に記入してください"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3 pb-4">
            <Button variant="outline" type="button" asChild>
              <Link href={`/projects/${id}`}>キャンセル</Link>
            </Button>
            <Button
              type="submit"
              className="bg-teal-600 hover:bg-teal-700"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                : <Save className="w-4 h-4 mr-2" />}
              保存する
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
