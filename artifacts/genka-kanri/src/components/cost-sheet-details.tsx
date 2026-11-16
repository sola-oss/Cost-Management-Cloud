import { Fragment, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { moveFocus } from "@/lib/grid-nav";

// ─── 工事原価計算書の下の明細（材料費・損料等及び消耗品）─────────────────────────
//
// Excel では下の明細に 日付・品名・色・容量・単価・数量 を打つと、月の合計が上の材料費のマスに入る
// （2026-11-16 アイさん「見るだけだと Excel と逆」）。ここでも明細に打つと仮の仕入として入り、
// 上の表の業者×月のマスに合計が出る。請求書で確定した行は灰色で、ここでは直せない。

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type DetailLine = {
  itemId: number;
  invoiceId: number;
  date: string;
  vendorId: number;
  vendorName: string;
  description: string;
  specification: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  stage: "provisional" | "confirmed";
  editable: boolean;
};

type Vendor = { id: number; name: string };

const yen = (n: number) => (n ? Math.round(n).toLocaleString("ja-JP") : "");
const numText = (n: number) => (n ? String(n) : "");
const monthJa = (d: string) => `${Number(d.slice(5, 7))}月`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const cell = "border-r border-b border-slate-300 px-1 py-0.5";
const head = "border-r border-b border-slate-300 px-2 py-1 bg-slate-100 text-slate-600 font-medium text-center whitespace-nowrap";
const inputCls =
  "w-full min-w-0 rounded px-1 py-0.5 text-sm border border-transparent hover:border-slate-300 focus:border-primary focus:bg-white focus:outline-none bg-transparent";

// 列：日付 / 仕入先 / 品名 / 色・品番 / 容量 / 単価 / 数量
type Field = "date" | "vendorId" | "description" | "specification" | "unit" | "unitPrice" | "quantity";

/** 矢印・Enter で隣へ。左右は文字の端にいるときだけ動かす（品名などを直すのを邪魔しない） */
function navKey(e: React.KeyboardEvent<HTMLInputElement>, onEnter?: () => void) {
  const el = e.currentTarget;
  const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
  const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
  const isDate = el.type === "date";
  let d: [number, number] | null = null;
  if (e.key === "ArrowUp" && !isDate) d = [-1, 0];
  else if (e.key === "ArrowDown" && !isDate) d = [1, 0];
  else if (e.key === "ArrowLeft" && (atStart || isDate)) d = [0, -1];
  else if (e.key === "ArrowRight" && (atEnd || isDate)) d = [0, 1];
  else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
    if (onEnter) {
      e.preventDefault();
      onEnter();
      return;
    }
    d = [e.shiftKey ? -1 : 1, 0];
  }
  if (!d) return;
  if (isDate && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return; // 日付の欄は年月日の移動に使う
  e.preventDefault();
  moveFocus(el, d[0], d[1]);
}

/** 1つの欄。ほかへ移ったときに保存する */
function FieldInput({
  value,
  pos,
  type = "text",
  align = "left",
  onSave,
}: {
  value: string;
  pos: string;
  type?: "text" | "date" | "number";
  align?: "left" | "right";
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      data-cs={pos}
      type={type === "date" ? "date" : "text"}
      inputMode={type === "number" ? "decimal" : undefined}
      value={draft ?? value}
      onFocus={(e) => {
        setDraft(value);
        const el = e.target;
        if (type !== "date") requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = draft;
        setDraft(null);
        if (v != null && v.trim() !== value) onSave(v.trim());
      }}
      onKeyDown={(e) => navKey(e)}
      className={`${inputCls} ${align === "right" ? "text-right tabular-nums" : ""}`}
    />
  );
}

function VendorPicker({
  value,
  vendors,
  onPick,
  onNew,
}: {
  value: number | null;
  vendors: Vendor[];
  onPick: (v: Vendor) => void;
  onNew: () => void;
}) {
  return (
    <Select
      value={value != null ? String(value) : ""}
      onValueChange={(id) => {
        if (id === "__new__") {
          setTimeout(onNew, 0);
          return;
        }
        const v = vendors.find((x) => String(x.id) === id);
        if (v) onPick(v);
      }}
    >
      <SelectTrigger className="h-7 text-sm border-transparent hover:border-slate-300 px-1 shadow-none">
        <SelectValue placeholder="仕入先" />
      </SelectTrigger>
      <SelectContent className="max-h-[320px]" searchPlaceholder="仕入先を探す">
        <SelectItem value="__new__" className="text-primary font-medium">＋ 新しい仕入先を登録する</SelectItem>
        {vendors.map((v) => (
          <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type Draft = {
  date: string;
  vendorId: number | null;
  description: string;
  specification: string;
  unit: string;
  unitPrice: string;
  quantity: string;
};

export function CostSheetDetails({
  projectId,
  category,
  label,
  lines,
  vendors,
  defaultDate,
  onChanged,
  onNewVendor,
}: {
  projectId: number;
  category: "material" | "expense";
  label: string;
  lines: DetailLine[];
  vendors: Vendor[];
  defaultDate: string | null;
  onChanged: () => Promise<void>;
  onNewVendor: (onPick: (v: Vendor) => void) => void;
}) {
  const { toast } = useToast();
  const last = lines[lines.length - 1];
  const emptyDraft = (): Draft => ({
    date: last?.date ?? defaultDate ?? today(),
    vendorId: last?.vendorId ?? null,
    description: "",
    specification: "",
    unit: "",
    unitPrice: "",
    quantity: "",
  });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [adding, setAdding] = useState(false);

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${BASE}/api/cost-sheet/${projectId}/detail-lines${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      toast({ title: "明細を保存できませんでした", description: b.message, variant: "destructive" });
      return false;
    }
    await onChanged();
    return true;
  };

  const saveField = (line: DetailLine, field: Field, raw: string) => {
    const v = field === "unitPrice" || field === "quantity" ? (raw === "" ? 0 : Number(raw.replace(/,/g, ""))) : raw;
    if ((field === "unitPrice" || field === "quantity") && !Number.isFinite(v as number)) {
      toast({ title: "数で入れてください", variant: "destructive" });
      return;
    }
    void call("PUT", `/${line.itemId}`, { [field]: v });
  };

  const add = async () => {
    if (!draft.description.trim()) {
      toast({ title: "品名を入れてください", variant: "destructive" });
      return;
    }
    if (draft.vendorId == null) {
      toast({ title: "仕入先を選んでください", variant: "destructive" });
      return;
    }
    const quantity = draft.quantity === "" ? 1 : Number(draft.quantity.replace(/,/g, ""));
    const unitPrice = draft.unitPrice === "" ? 0 : Number(draft.unitPrice.replace(/,/g, ""));
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      toast({ title: "数量・単価は数で入れてください", variant: "destructive" });
      return;
    }
    setAdding(true);
    const ok = await call("POST", "", {
      category,
      vendorId: draft.vendorId,
      date: draft.date,
      description: draft.description,
      specification: draft.specification,
      unit: draft.unit,
      quantity,
      unitPrice,
    });
    setAdding(false);
    if (ok) {
      // 日付と仕入先は続けて打つことが多いので残す（Excel で同じ日の行を続けて打つのと同じ）
      setDraft((d) => ({ ...d, description: "", specification: "", unit: "", unitPrice: "", quantity: "" }));
      requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>(`[data-detail-new="${category}"]`)?.focus();
      });
    }
  };

  // 月ごとにまとめ、月の合計を出す（Excel の「7月合計分」）
  const groups: { month: string; lines: DetailLine[] }[] = [];
  for (const l of lines) {
    const m = l.date.slice(0, 7);
    const g = groups[groups.length - 1];
    if (g && g.month === m) g.lines.push(l);
    else groups.push({ month: m, lines: [l] });
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  let rowNo = 0;
  const newRow = lines.length; // 足す行は明細のすぐ下の行として扱う（上から矢印で入れる）

  return (
    <div>
      <h3 className="font-semibold text-slate-700 mb-2">
        {label}の明細
        <span className="ml-2 text-xs font-normal text-slate-400">ここに打つと、上の表の{label}のマスに月の合計が入ります（仮・請求書待ち）</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-separate border-spacing-0 border-l border-t border-slate-300 text-sm">
          <thead>
            <tr>
              <th className={`${head} w-36`}>日付</th>
              <th className={`${head} w-44`}>仕入先</th>
              <th className={head}>品名</th>
              <th className={`${head} w-32`}>色・品番</th>
              <th className={`${head} w-20`}>容量</th>
              <th className={`${head} w-24`}>単価</th>
              <th className={`${head} w-16`}>数量</th>
              <th className={`${head} w-28`}>金額</th>
              <th className={`${head} w-10`} />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.month}>
                {g.lines.map((l) => {
                  const r = rowNo++;
                  if (!l.editable) {
                    return (
                      <tr key={l.itemId} className="text-slate-500 bg-slate-50/60">
                        <td className={`${cell} px-2 tabular-nums`}>{l.date.replaceAll("-", "/")}</td>
                        <td className={`${cell} px-2 truncate`} title={l.vendorName}>{l.vendorName}</td>
                        <td className={`${cell} px-2`}>{l.description}</td>
                        <td className={`${cell} px-2`}>{l.specification}</td>
                        <td className={`${cell} px-2`}>{l.unit}</td>
                        <td className={`${cell} px-2 text-right tabular-nums`}>{yen(l.unitPrice)}</td>
                        <td className={`${cell} px-2 text-right tabular-nums`}>{numText(l.quantity)}</td>
                        <td className={`${cell} px-2 text-right tabular-nums`}>{yen(l.amount)}</td>
                        <td className={`${cell} text-center`}>
                          <span className="text-[10px] rounded bg-emerald-50 text-emerald-700 px-1" title="請求書で確定した明細です（仕入入力の画面で直します）">確定</span>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={l.itemId} className="bg-amber-50/40">
                      <td className={cell}>
                        <FieldInput type="date" value={l.date} pos={`${r}:0`} onSave={(v) => saveField(l, "date", v)} />
                      </td>
                      <td className={cell}>
                        <VendorPicker
                          value={l.vendorId}
                          vendors={vendors}
                          onPick={(v) => v.id !== l.vendorId && void call("PUT", `/${l.itemId}`, { vendorId: v.id })}
                          onNew={() => onNewVendor((v) => void call("PUT", `/${l.itemId}`, { vendorId: v.id }))}
                        />
                      </td>
                      <td className={cell}><FieldInput value={l.description} pos={`${r}:2`} onSave={(v) => saveField(l, "description", v)} /></td>
                      <td className={cell}><FieldInput value={l.specification} pos={`${r}:3`} onSave={(v) => saveField(l, "specification", v)} /></td>
                      <td className={cell}><FieldInput value={l.unit} pos={`${r}:4`} onSave={(v) => saveField(l, "unit", v)} /></td>
                      <td className={cell}><FieldInput type="number" align="right" value={numText(l.unitPrice)} pos={`${r}:5`} onSave={(v) => saveField(l, "unitPrice", v)} /></td>
                      <td className={cell}><FieldInput type="number" align="right" value={numText(l.quantity)} pos={`${r}:6`} onSave={(v) => saveField(l, "quantity", v)} /></td>
                      <td className={`${cell} px-2 text-right tabular-nums`}>{yen(l.amount)}</td>
                      <td className={`${cell} text-center`}>
                        <button
                          type="button"
                          title="この行を消す"
                          onClick={() => { if (window.confirm(`「${l.description}」の行を消しますか？`)) void call("DELETE", `/${l.itemId}`); }}
                          className="text-slate-400 hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50 font-semibold">
                  <td className={`${cell} px-2 text-right`} colSpan={7}>{monthJa(g.month)}合計</td>
                  <td className={`${cell} px-2 text-right tabular-nums`}>{yen(g.lines.reduce((s, l) => s + l.amount, 0))}</td>
                  <td className={cell} />
                </tr>
              </Fragment>
            ))}

            {/* 新しい行。品名まで打って Enter（または＋）で足す */}
            <tr>
              <td className={cell}>
                <input
                  data-cs={`${newRow}:0`}
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                  onKeyDown={(e) => navKey(e, add)}
                  className={inputCls}
                />
              </td>
              <td className={cell}>
                <VendorPicker
                  value={draft.vendorId}
                  vendors={vendors}
                  onPick={(v) => setDraft((d) => ({ ...d, vendorId: v.id }))}
                  onNew={() => onNewVendor((v) => setDraft((d) => ({ ...d, vendorId: v.id })))}
                />
              </td>
              {(["description", "specification", "unit", "unitPrice", "quantity"] as const).map((f, i) => (
                <td key={f} className={cell}>
                  <input
                    data-cs={`${newRow}:${i + 2}`}
                    data-detail-new={f === "description" ? category : undefined}
                    inputMode={f === "unitPrice" || f === "quantity" ? "decimal" : undefined}
                    value={draft[f]}
                    placeholder={f === "description" ? "品名を打って Enter" : f === "quantity" ? "1" : ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                    onKeyDown={(e) => navKey(e, add)}
                    className={`${inputCls} border-dashed border-slate-300 ${f === "unitPrice" || f === "quantity" ? "text-right tabular-nums" : ""}`}
                  />
                </td>
              ))}
              <td className={`${cell} px-2 text-right tabular-nums text-slate-400`}>
                {yen((Number(draft.unitPrice.replace(/,/g, "")) || 0) * (draft.quantity === "" ? 1 : Number(draft.quantity.replace(/,/g, "")) || 0))}
              </td>
              <td className={`${cell} text-center`}>
                <button type="button" title="この行を足す" onClick={add} disabled={adding} className="text-primary hover:opacity-70">
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </button>
              </td>
            </tr>
            {lines.length > 0 && (
              <tr className="font-semibold">
                <td className={`${cell} px-2 text-right`} colSpan={7}>合計</td>
                <td className={`${cell} px-2 text-right tabular-nums`}>{yen(total)}</td>
                <td className={cell} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
