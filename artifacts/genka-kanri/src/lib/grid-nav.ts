/**
 * Excel のように矢印キー・Enter でマスを移る（工事原価計算書・明細で共通）。
 * マスの input に data-cs="行:列" を付けておくと、同じ表の中でその方向にある次の input へ移る
 * （打てないマスは input が無いので飛ばす）。
 */
export function moveFocus(from: HTMLElement, dRow: number, dCol: number) {
  const pos = from.dataset.cs?.split(":").map(Number);
  const table = from.closest("table");
  if (!pos || !table) return false;
  let [r, c] = pos;
  for (let i = 0; i < 200; i++) {
    r += dRow;
    c += dCol;
    if (r < 0 || c < 0) return false;
    const next = table.querySelector<HTMLInputElement>(`input[data-cs="${r}:${c}"]`);
    if (next) {
      next.focus();
      return true;
    }
  }
  return false;
}
