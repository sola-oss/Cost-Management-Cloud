import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation, Link } from "wouter";
import { useCreateProject } from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save } from "lucide-react";

const formSchema = z.object({
  projectCode: z.string().min(1, "工事番号は必須です"),
  name: z.string().min(1, "工事名称は必須です"),
  clientName: z.string().min(1, "発注者名は必須です"),
  location: z.string().min(1, "工事場所は必須です"),
  contractAmount: z.coerce.number().min(0, "請負金額は0以上である必要があります"),
  status: z.enum(["planning", "active", "completed", "suspended"]),
  startDate: z.string().min(1, "着工日は必須です"),
  endDate: z.string().min(1, "竣工予定日は必須です"),
  description: z.string().optional(),
});

export default function NewProject() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createProject = useCreateProject();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectCode: `P${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-`,
      name: "",
      clientName: "",
      location: "",
      contractAmount: 0,
      status: "planning",
      startDate: new Date().toISOString().split('T')[0],
      endDate: "",
      description: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createProject.mutate({ data: values }, {
      onSuccess: (data) => {
        toast({
          title: "登録完了",
          description: "新規工事を登録しました。",
        });
        setLocation(`/projects/${data.id}`);
      },
      onError: () => {
        toast({
          title: "エラー",
          description: "工事の登録に失敗しました。",
          variant: "destructive",
        });
      }
    });
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/projects"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">新規工事登録</h1>
          <p className="text-sm text-slate-500">新しい工事プロジェクトの基本情報を入力してください。</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>基本情報</CardTitle>
              <CardDescription>工事の特定に必要な情報です。</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                name="clientName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>発注者名 <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="例: 株式会社〇〇" {...field} />
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
                name="contractAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>請負金額（円） <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} />
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
                        <SelectTrigger>
                          <SelectValue placeholder="状態を選択" />
                        </SelectTrigger>
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

          <Card>
            <CardHeader>
              <CardTitle>工期・その他</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                name="description"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>備考</FormLabel>
                    <FormControl>
                      <Textarea placeholder="特記事項があれば入力してください" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

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
