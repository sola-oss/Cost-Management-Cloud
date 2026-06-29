import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 新規登録・更新した行を一時的にハイライト表示するためのフック。
 *
 * 使い方:
 *   const { mark, isNew } = useHighlightNew();
 *   // 登録/更新の成功時に  mark(created.id)
 *   // 行に  data-row-id={item.id}  と  className={cn(base, isNew(item.id) && "highlight-new")}
 *
 * ハイライトは CSS アニメーション(highlight-new)で数秒かけて消えます。
 * mark 時に対象行へ自動スクロールします。
 */
export function useHighlightNew(duration = 3200) {
  const [newId, setNewId] = useState<string | number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mark = useCallback(
    (id?: string | number | null) => {
      if (id === null || id === undefined) return;
      setNewId(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setNewId(null), duration);
      // 追加直後（再取得で行が後から現れる場合も）対象行までスクロール。
      // 行がまだ描画されていないことがあるので、見つかるまで数回リトライする。
      let tries = 0;
      const tryScroll = () => {
        const el = document.querySelector(`[data-row-id="${id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        if (tries++ < 8) setTimeout(tryScroll, 80);
      };
      requestAnimationFrame(tryScroll);
    },
    [duration],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const isNew = useCallback((id: string | number) => id === newId, [newId]);

  return { mark, isNew };
}
