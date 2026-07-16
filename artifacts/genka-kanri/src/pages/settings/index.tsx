import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCompanySettings, COMPANY_SETTINGS_QUERY_KEY } from "@/hooks/use-company-settings";
import { useCompanyBankAccounts, COMPANY_BANK_ACCOUNTS_QUERY_KEY, type CompanyBankAccount } from "@/hooks/use-company-bank-accounts";
import { toHankakuKana } from "@/lib/utils";
import { Loader2, Building2, Save, Plus, Trash2, Landmark } from "lucide-react";

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
  constructionLicense: string;
  staffName: string;
  staffMobile: string;
  staffEmail: string;
  consignorCode: string;
  companyNameKana: string;
  bankCode: string;
  bankNameKana: string;
  bankBranchCode: string;
  bankBranchKana: string;
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
  constructionLicense: "",
  staffName: "",
  staffMobile: "",
  staffEmail: "",
  consignorCode: "",
  companyNameKana: "",
  bankCode: "",
  bankNameKana: "",
  bankBranchCode: "",
  bankBranchKana: "",
};

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


/**
 * 振込先口座（見積書・請求書に印刷する口座）の編集。
 * 会社設定とは別テーブルなので、保存も会社設定の「保存する」とは独立している。
 */
function BankAccountsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: accounts = [], isLoading } = useCompanyBankAccounts();
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Omit<CompanyBankAccount, "id"> | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: COMPANY_BANK_ACCOUNTS_QUERY_KEY });

  const send = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}/api/company-bank-accounts${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({ message: "保存に失敗しました" }));
      throw new Error(msg.message ?? "保存に失敗しました");
    }
  };

  const handleSave = async (a: CompanyBankAccount) => {
    setSavingId(a.id);
    try {
      await send("PATCH", `/${a.id}`, a);
      await refresh();
      toast({ title: "保存しました", description: `${a.bankName} の口座を保存しました。` });
    } catch (e) {
      toast({ title: "保存に失敗しました", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const handleCreate = async () => {
    if (!draft) return;
    setSavingId("new");
    try {
      await send("POST", "", { ...draft, displayOrder: accounts.length });
      await refresh();
      setDraft(null);
      toast({ title: "追加しました", description: "振込先口座を追加しました。" });
    } catch (e) {
      toast({ title: "追加に失敗しました", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (a: CompanyBankAccount) => {
    if (!window.confirm(`${a.bankName} ${a.bankBranch} の口座を削除しますか？`)) return;
    try {
      await send("DELETE", `/${a.id}`);
      await refresh();
      toast({ title: "削除しました" });
    } catch (e) {
      toast({ title: "削除に失敗しました", description: (e as Error).message, variant: "destructive" });
    }
  };

  const row = (
    value: Omit<CompanyBankAccount, "id">,
    onChange: (v: Omit<CompanyBankAccount, "id">) => void,
  ) => (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">銀行名 <span className="text-red-500">*</span></Label>
          <Input value={value.bankName} onChange={(e) => onChange({ ...value, bankName: e.target.value })} className="mt-1" placeholder="山口銀行" />
        </div>
        <div>
          <Label className="text-xs">支店名</Label>
          <Input value={value.bankBranch} onChange={(e) => onChange({ ...value, bankBranch: e.target.value })} className="mt-1" placeholder="光支店" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">口座種別</Label>
          <Select value={value.accountType} onValueChange={(v) => onChange({ ...value, accountType: v })}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="普通">普通</SelectItem>
              <SelectItem value="当座">当座</SelectItem>
              <SelectItem value="貯蓄">貯蓄</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">口座番号 <span className="text-red-500">*</span></Label>
          <Input value={value.accountNumber} onChange={(e) => onChange({ ...value, accountNumber: e.target.value })} className="mt-1" placeholder="0080106" />
        </div>
        <div>
          <Label className="text-xs">口座名義</Label>
          <Input value={value.accountHolder} onChange={(e) => onChange({ ...value, accountHolder: e.target.value })} className="mt-1" placeholder="株式会社おおつか" />
        </div>
      </div>
    </>
  );

  return (
    <section className="bg-white rounded-xl border p-6 space-y-4">
      <div className="border-b pb-2">
        <h2 className="text-base font-semibold text-slate-700 flex items-center gap-2">
          <Landmark className="w-4 h-4 text-slate-400" />
          振込先口座（見積書・請求書に印刷）
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          得意先に振り込んでもらう口座です。複数登録すると、上から順に全部印刷されます。
          上の「振込元情報（全銀フォーマット用）」は仕入先へ支払うときの引落口座なので別物です。
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : (
        <>
          {accounts.length === 0 && !draft && (
            <p className="text-sm text-slate-400 py-2">まだ登録がありません。請求書の「お振込先口座」欄は空欄で印刷されます。</p>
          )}

          {accounts.map((a, i) => (
            <EditableAccount
              key={a.id}
              account={a}
              index={i}
              renderFields={row}
              saving={savingId === a.id}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ))}

          {draft ? (
            <div className="border rounded-lg p-4 space-y-3 bg-slate-50">
              <div className="text-xs font-medium text-slate-500">新しい振込先口座</div>
              {row(draft, setDraft)}
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>やめる</Button>
                <Button size="sm" onClick={handleCreate} disabled={savingId === "new"} className="gap-1">
                  {savingId === "new" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  追加する
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setDraft({ displayOrder: accounts.length, bankName: "", bankBranch: "", accountType: "普通", accountNumber: "", accountHolder: "" })}
            >
              <Plus className="w-3 h-3" />
              振込先口座を追加
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/** 既存口座1件分。編集して「保存」を押すまではサーバに送らない */
function EditableAccount({
  account,
  index,
  renderFields,
  saving,
  onSave,
  onDelete,
}: {
  account: CompanyBankAccount;
  index: number;
  renderFields: (v: Omit<CompanyBankAccount, "id">, onChange: (v: Omit<CompanyBankAccount, "id">) => void) => React.ReactNode;
  saving: boolean;
  onSave: (a: CompanyBankAccount) => void;
  onDelete: (a: CompanyBankAccount) => void;
}) {
  const [value, setValue] = useState<Omit<CompanyBankAccount, "id">>(account);
  useEffect(() => setValue(account), [account]);
  const dirty = JSON.stringify(value) !== JSON.stringify({ ...account });

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">振込先 {index + 1}</span>
        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 h-7 px-2" onClick={() => onDelete(account)}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      {renderFields(value, setValue)}
      {dirty && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => onSave({ ...value, id: account.id })} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            保存する
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CompanySettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CompanySettings>(defaultSettings);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data, isLoading } = useCompanySettings<CompanySettings>();

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
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
            <div>
              <Label>建設業許可番号</Label>
              <Input value={form.constructionLicense} onChange={(e) => set("constructionLicense", e.target.value)} className="mt-1" placeholder="例：山口県知事許可（般-XX）第XXXX号" />
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

        {/* 振込元情報（全銀フォーマット用） */}
        <section className="bg-white rounded-xl border p-6 space-y-4">
          <div className="border-b pb-2">
            <h2 className="text-base font-semibold text-slate-700">振込元情報（全銀フォーマット用）</h2>
            <p className="text-xs text-slate-400 mt-0.5">総合振込CSVの出力に使用します。カナ項目は半角カナで入力してください。</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>委託者コード</Label>
              <Input value={form.consignorCode} onChange={(e) => set("consignorCode", e.target.value)} className="mt-1" placeholder="銀行から付与される10桁" />
            </div>
            <div>
              <Label>会社名カナ</Label>
              <Input value={form.companyNameKana} onChange={(e) => set("companyNameKana", toHankakuKana(e.target.value))} className="mt-1" placeholder="半角カナ40桁以内" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>銀行コード</Label>
              <Input value={form.bankCode} onChange={(e) => set("bankCode", e.target.value)} className="mt-1" placeholder="4桁" />
            </div>
            <div>
              <Label>銀行名</Label>
              <Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} className="mt-1" placeholder="〇〇銀行" />
            </div>
            <div>
              <Label>銀行名カナ</Label>
              <Input value={form.bankNameKana} onChange={(e) => set("bankNameKana", toHankakuKana(e.target.value))} className="mt-1" placeholder="半角カナ15桁以内" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>支店コード</Label>
              <Input value={form.bankBranchCode} onChange={(e) => set("bankBranchCode", e.target.value)} className="mt-1" placeholder="3桁" />
            </div>
            <div>
              <Label>支店名</Label>
              <Input value={form.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} className="mt-1" placeholder="〇〇支店" />
            </div>
            <div>
              <Label>支店名カナ</Label>
              <Input value={form.bankBranchKana} onChange={(e) => set("bankBranchKana", toHankakuKana(e.target.value))} className="mt-1" placeholder="半角カナ15桁以内" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
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
            <div>
              <Label>口座名義</Label>
              <Input value={form.bankAccountName} onChange={(e) => set("bankAccountName", e.target.value)} className="mt-1" placeholder="ｶ）〇〇ｹﾝｾﾂ" />
            </div>
          </div>
        </section>

        <BankAccountsSection />

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
