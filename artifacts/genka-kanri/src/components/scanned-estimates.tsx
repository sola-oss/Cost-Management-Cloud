import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ScannedEstimate {
  id: number;
  vendorName: string;
  estimateNumber: string | null;
  estimateDate: string | null;
  printedTotal: number;
  decidedTotal: number;
  hasFile: boolean;
}

/**
 * ③下請見積書のスキャンから実行予算に入れた見積書の一覧。原本を開けるようにし、
 * 印字の合計と決定額の差（値引き）も見えるようにする。1件も無ければ何も出さない。
 */
export function ScannedEstimates({ projectId }: { projectId: number }) {
  const { data } = useQuery<{ items: ScannedEstimate[] }>({
    queryKey: ["/api/subcontract-estimates", projectId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/subcontract-estimates?projectId=${projectId}`);
      if (!r.ok) return { items: [] };
      return r.json();
    },
    enabled: !!projectId,
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded p-2 text-xs space-y-1">
      <div className="font-medium text-slate-500 flex items-center gap-1">
        <FileText className="w-3.5 h-3.5" /> スキャンした下請見積書
      </div>
      {items.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-700">
          <span className="font-medium">{e.vendorName}</span>
          {e.estimateDate && <span className="text-slate-400">{e.estimateDate}</span>}
          <span className="tabular-nums">決定額 {formatCurrency(e.decidedTotal)}</span>
          {e.printedTotal !== e.decidedTotal && (
            <span className="tabular-nums text-slate-400">（印字 {formatCurrency(e.printedTotal)}）</span>
          )}
          {e.hasFile && (
            <a
              href={`${BASE}/api/subcontract-estimates/${e.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              <ExternalLink className="w-3 h-3" /> 原本
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
