import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db, vendorsTable } from "@workspace/db";

const router: IRouter = Router();

// ─── AI 請求書読み取り（仮デジタル請求書の下書き抽出）──────────────────────────
//
// 下請の請求書PDF/画像を Claude のビジョンで読み取り、受領請求書の「下書き」を
// 構造化JSONで返す。ここでは登録は一切行わない（人が確認・修正してから確定する）。
//
// 設計方針（実物3枚の確認で確定）：
//  - モデルは claude-sonnet-5。請求書の読み取りにOpusは過剰（コスト3〜5分の1）。
//  - タイプを固定分岐にしない。「伝票番号あるか / 現場名あるか / 明細が読めるか」の
//    3つの状態を抽出し、その組み合わせで画面が変わる。未知の様式もこれで吸収する。
//  - 工事名は読ませない（手書きの工事名を読ませないのが今回の設計の要）。現場名の
//    「印字」だけ deliveryTo に拾い、工事の特定は人の選択に委ねる。
//  - 入金・繰越・値引・小計・合計・消費税等の「非仕入行」は isNonPurchase=true にして
//    原価から除外する（いわさき工房の「入金 振込 -43,670」対策）。
//  - 返品・値引のマイナス金額はそのまま許容する（大田鋼管の返品 -3,532 など）。
//  - 金額の検算はコード側で行う（AIの再呼び出しはしない）。
//
// ANTHROPIC_API_KEY が必要。

const MODEL = "claude-sonnet-5";

// 完成工事原価の4区分。Claude にこのいずれかへ寄せさせる。
const CATEGORY_ENUM = ["material", "labor", "subcontract", "expense"] as const;

// 構造化出力のスキーマ（受領請求書の下書き）。
// 構造化出力の制約上、全オブジェクトに additionalProperties:false と required を付ける。
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendorName: { type: "string", description: "請求元（仕入先）の会社名" },
    invoiceDate: { type: "string", description: "請求日 YYYY-MM-DD。不明なら空文字" },
    paymentDueDate: { type: "string", description: "支払期日 YYYY-MM-DD。無ければ空文字" },
    items: {
      type: "array",
      description: "明細行。上から順に、請求書に並んでいるとおり全行を返す",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slipNo: { type: "string", description: "伝票番号・納品書番号。行の左端などに印字される番号。無ければ空文字" },
          deliveryDate: { type: "string", description: "納品日・出荷日 YYYY-MM-DD。無ければ空文字" },
          deliveryTo: { type: "string", description: "納品先・現場名の印字（例:『有間様邸』）。摘要欄に印字されていれば拾う。無ければ空文字。手書きは読まない" },
          category: { type: "string", enum: [...CATEGORY_ENUM], description: "材料費=material 労務費=labor 外注費=subcontract 経費=expense。判断が難しければ material" },
          description: { type: "string", description: "品目・摘要" },
          quantity: { type: "number", description: "数量。不明なら1" },
          unit: { type: "string", description: "単位。不明なら式" },
          unitPrice: { type: "number", description: "単価（カンマ無し）。不明なら0" },
          amount: { type: "number", description: "金額（カンマ無し）。返品・値引はマイナスのまま返す" },
          taxRate: { type: "number", description: "税率(%)。明記が無ければ10、軽減なら8" },
          isNonPurchase: { type: "boolean", description: "請求書全体に対する調整・集計の行なら true（入金・繰越・前月繰越・小計・伝票計・合計・消費税等）。商品や工事に紐づく行は返品・値引きであっても false（金額をマイナスで返す）" },
        },
        required: ["slipNo", "deliveryDate", "deliveryTo", "category", "description", "quantity", "unit", "unitPrice", "amount", "taxRate", "isNonPurchase"],
      },
    },
    subtotal: { type: "number", description: "税抜合計（カンマ無し）" },
    taxAmount: { type: "number", description: "消費税額（カンマ無し）" },
    totalAmount: { type: "number", description: "税込・今回ご請求額（カンマ無し）" },
    handwritten: { type: "boolean", description: "明細が主に手書きで、数量・単価の読み取りが不確実なら true" },
  },
  required: ["vendorName", "invoiceDate", "paymentDueDate", "items", "subtotal", "taxAmount", "totalAmount", "handwritten"],
} as const;

const SYSTEM_PROMPT = `あなたは日本の建設業の経理担当を補助するアシスタントです。
渡された下請の請求書（PDFまたは画像）から、受領請求書の下書きを抽出してください。

ルール：
- 金額はカンマや「円」を除いた数値で返す（例: 1,234,000 → 1234000）。
- 返品・値引き・マイナス調整の行は、金額をマイナスのまま返す（例: -3,532）。
- 日付は YYYY-MM-DD 形式。読み取れない日付は空文字 "" にする。
- 和暦は必ず西暦に直す。**令和N年 = 西暦(2018+N)年**（例: 令和8年=2026年、令和7年=2025年、令和6年=2024年）。
  請求書内で年が省略され月日だけの行（例「6.5」「6/30」）は、請求日の年に合わせること。
- 伝票番号・納品書番号(slipNo)が行に印字されていれば必ず拾う。これで明細をまとめる。無ければ空文字。
- 納品先・現場名(deliveryTo)は「印字されているものだけ」拾う。手書きの現場名は読まない（空文字にする）。
- 区分(category)は内容から判断して 材料費/労務費/外注費/経費 のいずれかに寄せる。難しければ material。
- isNonPurchase の判断は「その行が商品・工事に紐づくか」で決める。原価が狂うので厳密に。
  - true にするのは、請求書全体に対する調整・集計の行だけ：
    入金・振込・繰越・前月繰越・小計・伝票計・合計・総合計・消費税等
  - false にするのは、商品や工事に紐づく行すべて。**返品・値引き・戻しも false**にして
    金額をマイナスで返す（返品は原価を減らす行であり、集計行ではない）。
    例：「パイプガード直管（返品） -3,532」→ isNonPurchase=false, amount=-3532
- 明細が主に手書きで数量・単価が不確実なら handwritten を true にする。無理に創作せず、読めない数値は0にする。
- これは人が確認して修正する「下書き」です。確実でない箇所は推測で埋めず、空・0のままにしてください。`;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

router.post("/purchase-invoice", async (req, res) => {
  try {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      return res.status(503).json({
        message: "AI読み取りが未設定です。環境変数 ANTHROPIC_API_KEY を設定してください。",
      });
    }

    const { fileBase64, mediaType } = req.body as {
      fileBase64?: string;
      mediaType?: string;
    };
    if (!fileBase64) {
      return res.status(400).json({ message: "fileBase64 が必要です" });
    }
    const media = mediaType ?? "application/pdf";
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(media)) {
      return res.status(400).json({ message: `対応していない形式です: ${media}` });
    }

    // PDF は document ブロック、画像は image ブロックで渡す。
    const fileBlock =
      media === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } } as const)
        : ({ type: "image", source: { type: "base64", media_type: media as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: fileBase64 } } as const);

    const client = new Anthropic();
    // 明細が多い請求書（大田鋼管は3ページ25行）は出力が長くなり、8192では
    // JSONが途中で切れて解析に失敗していた。上限を上げ、長い応答でHTTPが
    // タイムアウトしないようストリーミングで受ける。
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            { type: "text", text: "この請求書を読み取って、スキーマに従い受領請求書の下書きをJSONで返してください。" },
          ],
        },
      ],
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ message: "AIがこの文書の読み取りを拒否しました。別のファイルでお試しください。" });
    }
    // ② 出力上限に達した場合。JSONが途中で切れているので解析しても意味がない。
    //    原因が分かるメッセージを返す（以前は「解析に失敗」としか出なかった）。
    if (response.stop_reason === "max_tokens") {
      req.log.warn({ usage: response.usage }, "AI extraction hit max_tokens");
      return res.status(422).json({
        message: "明細が多く、AIが最後まで読み切れませんでした。ページを分けてアップロードするか、手入力をお使いください。",
      });
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return res.status(502).json({ message: "AIから有効な応答が得られませんでした。" });
    }

    let draft: {
      vendorName?: string;
      subtotal?: number;
      taxAmount?: number;
      totalAmount?: number;
      items?: Array<{ amount?: number; isNonPurchase?: boolean }>;
    };
    try {
      draft = JSON.parse(textBlock.text);
    } catch {
      req.log.error(
        { stopReason: response.stop_reason, usage: response.usage, head: textBlock.text.slice(0, 300) },
        "Failed to parse AI response",
      );
      return res.status(502).json({ message: "AI応答の解析に失敗しました。もう一度お試しください。" });
    }

    // ── 金額の検算（コード側。AIの再呼び出しはしない）──────────────────────────
    // 仕入行（isNonPurchase=false）の金額合計を、AIが読んだ請求総額と突き合わせる。
    // 大きくズレたら amountMismatch=true を返し、画面で警告する。
    const items = Array.isArray(draft.items) ? draft.items : [];
    const purchaseSum = items
      .filter((it) => !it.isNonPurchase)
      .reduce((s, it) => s + num(it.amount), 0);
    const subtotal = num(draft.subtotal);
    const tax = num(draft.taxAmount);
    const total = num(draft.totalAmount);

    // 検算は「税抜どうし」で行う。仕入行の合計は税抜なので、税込の請求額と比べると
    // 必ず税額分ズレて誤検知になる（実データで発覚）。
    // 税抜合計が取れていればそれと、取れていなければ「税込 − 税額」と突き合わせる。
    const expectedNet = subtotal > 0 ? subtotal : (total > 0 && tax > 0 ? total - tax : 0);
    // 金額は請求書に印字された数字なので、本来は円単位で一致する。
    // 以前は2%の許容にしており、返品行の取り違え（3,532円のズレ）を見逃していた。
    const tolerance = Math.max(Math.round(expectedNet * 0.005), 100); // 0.5% か 100円の大きい方
    const amountDiff = expectedNet > 0 ? Math.round(purchaseSum - expectedNet) : 0;
    const amountMismatch = expectedNet > 0 && Math.abs(amountDiff) > tolerance;

    // 仕入先名を既存マスタに突合して候補を返す（自動では紐づけない）。
    const vendorName = (draft.vendorName ?? "").trim();
    let vendorMatches: { id: number; name: string; exact: boolean }[] = [];
    if (vendorName) {
      const vendors = await db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable);
      const strip = (s: string) => s.replace(/\s|株式会社|（株）|\(株\)|有限会社|（有）|\(有\)/g, "");
      const needle = strip(vendorName);
      vendorMatches = vendors
        .map((v) => {
          const hay = strip(v.name);
          const exact = v.name === vendorName;
          const hit = exact || (needle.length > 0 && (hay.includes(needle) || needle.includes(hay)));
          return hit ? { id: v.id, name: v.name, exact } : null;
        })
        .filter((x): x is { id: number; name: string; exact: boolean } => x !== null)
        .sort((a, b) => Number(b.exact) - Number(a.exact))
        .slice(0, 5);
    }

    return res.json({ draft, vendorMatches, amountMismatch, amountDiff, expectedNet, purchaseSum });
  } catch (err) {
    req.log.error({ err }, "Failed to AI-extract purchase invoice");
    return res.status(500).json({ message: "AI読み取り中にエラーが発生しました。" });
  }
});

export default router;
