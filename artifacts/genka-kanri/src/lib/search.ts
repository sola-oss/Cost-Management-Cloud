/**
 * 日本語の表記ゆれを吸収する検索ユーティリティ。
 *
 * プルダウン（ui/select.tsx）と品名サジェスト（item-name-input.tsx）で共用する。
 * 「ＣＥＲＡ」を cera で、「山陽」を さんよう / sannyou で引けるようにするのが目的。
 */

// 全角/半角・大文字小文字・カタカナ/ひらがな・スペースや記号の揺れを吸収する
// 例）「ＣＥＲＡ」→「cera」、「ｻﾝﾖｳｹﾝｾﾂｻ-ﾋﾞｽ」→「さんようけんせつさびす」
export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFKC") // 全角英数→半角、半角ｶﾅ→全角カナ、㈱→(株) など
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)) // カタカナ→ひらがな
    .replace(/[\s　ー\-‐‑–—−･・．.,、。()（）]/g, ""); // スペース・長音・記号の揺れを除去
}

// ローマ字→ひらがな（IMEと同じ規則の簡易版。変換しきれない場合は null）
const ROMAJI_TABLE: Record<string, string> = {
  kya: "きゃ", kyu: "きゅ", kyo: "きょ", sha: "しゃ", shu: "しゅ", sho: "しょ",
  sya: "しゃ", syu: "しゅ", syo: "しょ", cha: "ちゃ", chu: "ちゅ", cho: "ちょ",
  tya: "ちゃ", tyu: "ちゅ", tyo: "ちょ", nya: "にゃ", nyu: "にゅ", nyo: "にょ",
  hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ", mya: "みゃ", myu: "みゅ", myo: "みょ",
  rya: "りゃ", ryu: "りゅ", ryo: "りょ", gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ",
  jya: "じゃ", jyu: "じゅ", jyo: "じょ", bya: "びゃ", byu: "びゅ", byo: "びょ",
  pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ", shi: "し", chi: "ち", tsu: "つ",
  thi: "てぃ", dhi: "でぃ",
  ja: "じゃ", ju: "じゅ", jo: "じょ", ji: "じ",
  fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ", fu: "ふ",
  va: "ゔぁ", vi: "ゔぃ", vu: "ゔ", ve: "ゔぇ", vo: "ゔぉ",
  wi: "うぃ", we: "うぇ",
  a: "あ", i: "い", u: "う", e: "え", o: "お",
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ",
  sa: "さ", si: "し", su: "す", se: "せ", so: "そ",
  ta: "た", ti: "ち", tu: "つ", te: "て", to: "と",
  na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
  ha: "は", hi: "ひ", hu: "ふ", he: "へ", ho: "ほ",
  ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
  ya: "や", yu: "ゆ", yo: "よ",
  ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ",
  wa: "わ", wo: "を",
  ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
  za: "ざ", zi: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
  ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ",
  pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
};

export function romajiToHiragana(input: string): string | null {
  let s = input;
  let out = "";
  while (s.length > 0) {
    if (s.startsWith("nn")) { out += "ん"; s = s.slice(2); continue; }
    if (s[0] === "n" && s.length > 1 && !"aiueoyn".includes(s[1])) { out += "ん"; s = s.slice(1); continue; }
    if (s === "n") { out += "ん"; break; }
    if (s.length > 1 && s[0] === s[1] && s[0] !== "n" && /[bcdfghjklmpqrstvwxyz]/.test(s[0])) {
      out += "っ"; s = s.slice(1); continue;
    }
    let hit = false;
    for (const len of [3, 2, 1]) {
      const chunk = s.slice(0, len);
      const kana = ROMAJI_TABLE[chunk];
      if (kana) { out += kana; s = s.slice(len); hit = true; break; }
    }
    if (!hit) return null; // 変換できない綴り
  }
  return out;
}

/** 検索一致判定：正規化した上で部分一致。クエリが英字だけならローマ字→かな変換も試す。 */
export function searchMatch(text: string, query: string): boolean {
  const t = normalizeForSearch(text);
  const q = normalizeForSearch(query);
  if (q === "") return true;
  if (t.includes(q)) return true;
  if (/^[a-z]+$/.test(q)) {
    const hira = romajiToHiragana(q);
    if (hira && t.includes(hira)) return true;
  }
  return false;
}
