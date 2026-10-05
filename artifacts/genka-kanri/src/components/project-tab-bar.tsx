import { FileText, HardHat, Calculator, ClipboardList, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── 工事詳細のタブ ─────────────────────────────────────────────────────────
//
// おおつか様の依頼（2026-09-17 3-2）：実行予算の画面から戻ったとき、どのタブ・どの画面に
// いるのか分からない。→ タブを画面の上に置き、タブごとに色を付けて、いま開いているタブを塗りつぶす。
// 実行予算は別ページだが、同じタブ帯を出して「工事詳細の中にいる」ことが分かるようにする。
// 開いているタブは URL の ?tab= に持たせる（戻ったときに同じタブが開くように）。

export type ProjectTabKey = "basic" | "attendance" | "budget" | "costs" | "financial";

export const PROJECT_TABS: {
  key: ProjectTabKey;
  label: string;
  icon: typeof FileText;
  active: string;
  idle: string;
  panel: string;
}[] = [
  { key: "basic",      label: "基本情報", icon: FileText,      active: "bg-slate-600 text-white border-slate-600",     idle: "text-slate-700 border-slate-300 hover:bg-slate-50",    panel: "border-t-slate-600" },
  { key: "attendance", label: "出面",     icon: HardHat,       active: "bg-violet-600 text-white border-violet-600",   idle: "text-violet-700 border-violet-300 hover:bg-violet-50", panel: "border-t-violet-600" },
  { key: "budget",     label: "実行予算", icon: Calculator,    active: "bg-blue-600 text-white border-blue-600",       idle: "text-blue-700 border-blue-300 hover:bg-blue-50",       panel: "border-t-blue-600" },
  { key: "costs",      label: "原価明細", icon: ClipboardList, active: "bg-orange-600 text-white border-orange-600",   idle: "text-orange-700 border-orange-300 hover:bg-orange-50", panel: "border-t-orange-600" },
  { key: "financial",  label: "収支状況", icon: BarChart2,     active: "bg-teal-600 text-white border-teal-600",       idle: "text-teal-700 border-teal-300 hover:bg-teal-50",       panel: "border-t-teal-600" },
];

export const DEFAULT_PROJECT_TAB: ProjectTabKey = "financial";

export function parseProjectTab(search: string): ProjectTabKey {
  const t = new URLSearchParams(search).get("tab");
  return PROJECT_TABS.some((x) => x.key === t) ? (t as ProjectTabKey) : DEFAULT_PROJECT_TAB;
}

export function ProjectTabBar({
  current,
  onSelect,
  badges,
  className,
}: {
  current: ProjectTabKey;
  onSelect: (key: ProjectTabKey) => void;
  badges?: Partial<Record<ProjectTabKey, string>>;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("grid grid-cols-5 gap-1.5", className)}>
      {PROJECT_TABS.map((t) => {
        const isActive = t.key === current;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.key)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md border-2 bg-white px-2 py-2 text-xs sm:text-sm font-bold transition-colors",
              isActive ? `${t.active} shadow` : t.idle,
            )}
          >
            <Icon className="w-4 h-4 hidden sm:block" />
            {t.label}
            {badges?.[t.key] && (
              <span className={cn(
                "ml-0.5 rounded px-1 text-[10px] leading-4",
                isActive ? "bg-white/25 text-white" : "bg-orange-500 text-white",
              )}>
                {badges[t.key]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
