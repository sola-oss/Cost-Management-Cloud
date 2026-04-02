import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Building2, Save } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CompanySettings {
  id: number | null;
  companyName: string;
  postalCode: string;
  address: string;
  tel: string;
  fax: string;
  invoiceRegistrationNumber: string;
  representativeName: string;
  department: string;
  bankName: string;
  bankBranch: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

const defaultSettings: CompanySettings = {
  id: null,
  companyName: "",
  postalCode: "",
  address: "",
  tel: "",
  fax: "",
  invoiceRegistrationNumber: "",
  representativeName: "",
  department: "",
  bankName: "",
  bankBranch: "",
  bankAccountType: "普通",
  bankAccountNumber: "",
  bankAccountName: "",
};

async function fetchSettings(): Promise<CompanySettings> {
  const res = await fetch(`${BASE}/api/company-settings`);
  if (!res.ok) throw new Error("Failed to fetch company settings");
  return res.json();
}

async function saveSettings(data: Omit<CompanySettings, "id">): Promise<CompanySettings> {
  const res = await fetch(`${BASE}/api/company-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save company settings");
  return res.json();
}

function validateInvoiceNumber(v: string): boolean {
  if (!v) return true;
  return /^T\d{13}$/.test(v);
}

export default function CompanySettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CompanySettings>(defaultSettings);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["/api/company-settings"],
    queryFn: fetchSettings,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "保存しました", description: "会社設定を保存しました。" });
    },
    onError: () => {
      toast({ title: "保存に失敗しました", variant: "destructive" });
    },
  });

  const set = (field: keyof CompanySettings, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!form.companyName.trim()) newErrors.companyName = "会社名は必須です";
    if (form.invoiceRegistrationNumber && !validateInvoiceNumber(form.invoiceRegistrationNumber)) {
      newErrors.invoiceRegistrationNumber = "T+13桁の数字で入力してください（例: T1234567890123）";
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    const { id, ...rest } = form;
    mutation.mutate(rest);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-primary/10 p-2 rounded-lg">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">会社設定</h1>
          <p className="text-sm text-slate-500">会社情報・インボイス番号・銀行情報を管理します</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* 会社基本情報 */}
        <section className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2">会社基本情報</h2>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label>会社名 <span className="text-red-500">*</span></Label>
              <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} className="mt-1" placeholder="株式会社〇〇建設" />
              {errors.companyName && <p className="text-xs text-red-500 mt-1">{errors.companyName}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>郵便番号</Label>
                <Input value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)} className="mt-1" placeholder="000-0000" />
              </div>
            </div>
            <div>
              <Label>住所</Label>
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} className="mt-1" placeholder="東京都〇〇区..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>電話番号</Label>
                <Input value={form.tel} onChange={(e) => set("tel", e.target.value)} className="mt-1" placeholder="03-0000-0000" />
              </div>
              <div>
                <Label>FAX番号</Label>
                <Input value={form.fax} onChange={(e) => set("fax", e.target.value)} className="mt-1" placeholder="03-0000-0001" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>代表者名</Label>
                <Input value={form.representativeName} onChange={(e) => set("representativeName", e.target.value)} className="mt-1" placeholder="山田 太郎" />
              </div>
              <div>
                <Label>担当部署</Label>
                <Input value={form.department} onChange={(e) => set("department", e.target.value)} className="mt-1" placeholder="工事部" />
              </div>
            </div>
          </div>
        </section>

        {/* インボイス情報 */}
        <section className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2">インボイス（適格請求書）情報</h2>
          <div>
            <Label>適格請求書発行事業者登録番号</Label>
            <Input
              value={form.invoiceRegistrationNumber}
              onChange={(e) => set("invoiceRegistrationNumber", e.target.value)}
              className="mt-1"
              placeholder="T1234567890123（T+13桁）"
            />
            {errors.invoiceRegistrationNumber && (
              <p className="text-xs text-red-500 mt-1">{errors.invoiceRegistrationNumber}</p>
            )}
            <p className="text-xs text-slate-400 mt-1">例: T1234567890123（「T」+ 13桁の数字）</p>
          </div>
        </section>

        {/* 銀行情報 */}
        <section className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-700 border-b pb-2">振込先銀行情報</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>銀行名</Label>
              <Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} className="mt-1" placeholder="〇〇銀行" />
            </div>
            <div>
              <Label>支店名</Label>
              <Input value={form.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} className="mt-1" placeholder="〇〇支店" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>口座種別</Label>
              <Select value={form.bankAccountType} onValueChange={(v) => set("bankAccountType", v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="普通">普通</SelectItem>
                  <SelectItem value="当座">当座</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>口座番号</Label>
              <Input value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} className="mt-1" placeholder="1234567" />
            </div>
          </div>
          <div>
            <Label>口座名義</Label>
            <Input value={form.bankAccountName} onChange={(e) => set("bankAccountName", e.target.value)} className="mt-1" placeholder="カ）〇〇ケンセツ" />
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="gap-2">
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            保存する
          </Button>
        </div>
      </div>
    </div>
  );
}
