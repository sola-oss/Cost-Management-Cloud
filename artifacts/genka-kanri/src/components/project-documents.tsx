import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type DocKind = "prime_order" | "client_estimate" | "subcontract_estimate" | "delivery_note" | "invoice";

interface ProjectDocument {
  kind: DocKind;
  key: string;
  title: string;
  date: string | null;
  amount: number | null;
  fileUrl: string;
  mediaType: string | null;
}

// スキャン画面と同じ①〜⑤の順・同じ呼び名で並べる
const GROUPS: { kind: DocKind; label: string; note?: string }[] = [
  { kind: "prime_order", label: "① 元請注文書" },
  { kind: "client_estimate", label: "② 確定見積書・契約書" },
  { kind: "subcontract_estimate", label: "③ 下請見積書", note: "金額は決まった額（手書きの訂正があればそちら）" },
  { kind: "delivery_note", label: "④ 納品書", note: "金額は書類1枚の合計です（ほかの工事の分を含むことがあります）" },
  { kind: "invoice", label: "⑤ 請求書", note: "金額は書類1枚の合計です（ほかの工事の分を含むことがあります）" },
];

/**
 * 工事詳細の「書類」タブ。この工事にスキャンして入れた原本を、種類ごとに並べて開けるようにする。
 * 温品様の依頼（2026-11-12）：スキャンで取り込んだ原本を、工事の中でカテゴリ別に見返したい。
 */
export function ProjectDocuments({ projectId }: { projectId: number }) {
  const { data, isLoading, isError } = useQuery<ProjectDocument[]>({
    queryKey: ["/api/projects/documents", projectId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/projects/${projectId}/documents`);
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
  });

  if (isLoading) {
    return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  }
  if (isError || !data) {
    return <div className="py-6 text-sm text-destructive">書類を読み込めませんでした。</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        この工事にスキャンして入れた書類の原本です。書類名を押すと原本が開きます。
      </p>
      {GROUPS.map((g) => {
        const docs = data.filter((d) => d.kind === g.kind);
        return (
          <section key={g.kind} className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-baseline justify-between gap-2 px-4 py-2.5 border-b bg-slate-50/60">
              <h3 className="text-sm font-semibold text-slate-800">
                {g.label}
                <span className="ml-2 text-xs font-normal text-slate-500">{docs.length}件</span>
              </h3>
              {g.note && docs.length > 0 && <span className="text-xs text-slate-400">{g.note}</span>}
            </div>
            {docs.length === 0 ? (
              <div className="px-4 py-3 text-xs text-slate-400">まだありません</div>
            ) : (
              <ul className="divide-y">
                {docs.map((d) => {
                  const Icon = d.mediaType?.startsWith("image/") ? ImageIcon : FileText;
                  return (
                    <li key={d.key}>
                      <a
                        href={`${BASE}${d.fileUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50/60"
                      >
                        <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-xs text-slate-500 w-24 shrink-0 tabular-nums">{d.date ?? "—"}</span>
                        <span className="flex-1 min-w-0 truncate text-sm text-primary underline-offset-2 hover:underline">
                          {d.title}
                        </span>
                        {d.amount != null && d.amount !== 0 && (
                          <span className="text-sm tabular-nums text-slate-700">{formatCurrency(d.amount)}</span>
                        )}
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
