// スキャンする画面で選んだファイルを、読み取り先の画面へ渡すための置き場。
// ④⑤と同じく「種類を押す → すぐファイル選択」にしたまま、①は確認画面が別ページにあるため、
// 選んだファイルをここに置いてから移る。受け取った側が取り出したら空にする。
let pending: File | null = null;

export function setPendingScanFile(file: File) {
  pending = file;
}

export function takePendingScanFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}
