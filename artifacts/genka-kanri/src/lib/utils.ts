import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "¥0";
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
  }).format(amount);
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "0.0%";
  return `${rate.toFixed(1)}%`;
}

// 全角カナ・ひらがな・全角英数を半角に変換する（全銀フォーマットのカナ欄用）。
// 漢字など変換対象外の文字はそのまま残す（出力直前のバイト数ガードが弾く）。
const FULLWIDTH_KATA_TO_HANKAKU: Record<number, string> = {
  0x30a1: "ｧ", 0x30a2: "ｱ", 0x30a3: "ｨ", 0x30a4: "ｲ", 0x30a5: "ｩ",
  0x30a6: "ｳ", 0x30a7: "ｪ", 0x30a8: "ｴ", 0x30a9: "ｫ", 0x30aa: "ｵ",
  0x30ab: "ｶ", 0x30ac: "ｶﾞ", 0x30ad: "ｷ", 0x30ae: "ｷﾞ", 0x30af: "ｸ",
  0x30b0: "ｸﾞ", 0x30b1: "ｹ", 0x30b2: "ｹﾞ", 0x30b3: "ｺ", 0x30b4: "ｺﾞ",
  0x30b5: "ｻ", 0x30b6: "ｻﾞ", 0x30b7: "ｼ", 0x30b8: "ｼﾞ", 0x30b9: "ｽ",
  0x30ba: "ｽﾞ", 0x30bb: "ｾ", 0x30bc: "ｾﾞ", 0x30bd: "ｿ", 0x30be: "ｿﾞ",
  0x30bf: "ﾀ", 0x30c0: "ﾀﾞ", 0x30c1: "ﾁ", 0x30c2: "ﾁﾞ", 0x30c3: "ｯ",
  0x30c4: "ﾂ", 0x30c5: "ﾂﾞ", 0x30c6: "ﾃ", 0x30c7: "ﾃﾞ", 0x30c8: "ﾄ",
  0x30c9: "ﾄﾞ", 0x30ca: "ﾅ", 0x30cb: "ﾆ", 0x30cc: "ﾇ", 0x30cd: "ﾈ",
  0x30ce: "ﾉ", 0x30cf: "ﾊ", 0x30d0: "ﾊﾞ", 0x30d1: "ﾊﾟ", 0x30d2: "ﾋ",
  0x30d3: "ﾋﾞ", 0x30d4: "ﾋﾟ", 0x30d5: "ﾌ", 0x30d6: "ﾌﾞ", 0x30d7: "ﾌﾟ",
  0x30d8: "ﾍ", 0x30d9: "ﾍﾞ", 0x30da: "ﾍﾟ", 0x30db: "ﾎ", 0x30dc: "ﾎﾞ",
  0x30dd: "ﾎﾟ", 0x30de: "ﾏ", 0x30df: "ﾐ", 0x30e0: "ﾑ", 0x30e1: "ﾒ",
  0x30e2: "ﾓ", 0x30e3: "ｬ", 0x30e4: "ﾔ", 0x30e5: "ｭ", 0x30e6: "ﾕ",
  0x30e7: "ｮ", 0x30e8: "ﾖ", 0x30e9: "ﾗ", 0x30ea: "ﾘ", 0x30eb: "ﾙ",
  0x30ec: "ﾚ", 0x30ed: "ﾛ", 0x30ee: "ﾜ", 0x30ef: "ﾜ", 0x30f0: "ｲ",
  0x30f1: "ｴ", 0x30f2: "ｦ", 0x30f3: "ﾝ", 0x30f4: "ｳﾞ", 0x30f5: "ｶ",
  0x30f6: "ｹ", 0x30fb: "･", 0x30fc: "ｰ",
};

export function toHankakuKana(str: string): string {
  if (!str) return "";
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    if (cp >= 0xff01 && cp <= 0xff5e) {
      result += String.fromCharCode(cp - 0xfee0); // 全角英数記号 → 半角
    } else if (cp === 0x3000) {
      result += " "; // 全角スペース → 半角
    } else if (cp >= 0x3041 && cp <= 0x3096) {
      result += FULLWIDTH_KATA_TO_HANKAKU[cp + 0x60] ?? str[i]; // ひらがな → 半角カナ
    } else if (cp >= 0x30a1 && cp <= 0x30fc) {
      result += FULLWIDTH_KATA_TO_HANKAKU[cp] ?? str[i]; // 全角カナ → 半角カナ
    } else {
      result += str[i];
    }
  }
  return result;
}
