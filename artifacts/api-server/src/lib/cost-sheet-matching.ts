// ─── 工事原価計算書：仮（納品書・マスに打った金額）と請求書の照合 ─────────────────
//
// 温品様の流れ（2026-11-16）：納品書が届いたら工事原価計算書のマスに金額を打つ（＝仮原価）。
// あとで請求書をスキャンすると確定原価の伝票ができるので、同じ「業者×月」の仮と突き合わせる。
//   差がない     → 自動で確定（仮の伝票に settled_by_invoice_id を入れ、仮は数えなくなる）
//   差がある     → 「確認待ち」として表の下の一覧に出し、人が［確定する］を押す
//   請求書が無い → 「請求書待ち」
// 請求書の日付は翌月になることがある（月末締めで翌月頭に届く等）ので、その月に請求書が無く、
// 翌月に仮の無い請求書があれば、それと組にする。
// 仮と請求書は N 対 1（何枚かの納品書を1枚の月締め請求書でまとめて精算する）。

export type MatchInvoice = {
  id: number;
  vendorId: number;
  vendorName: string;
  stage: string;
  settledByInvoiceId: number | null;
  month: string; // YYYY-MM（伝票の日付）
  amount: number; // 税抜
};

export type MatchRow = {
  vendorId: number;
  vendorName: string;
  month: string; // 仮の月
  invoiceMonth: string | null; // 請求書の月
  provisional: number;
  invoice: number | null;
  difference: number | null; // 請求書 − 仮
  status: "settled" | "review" | "auto" | "waiting";
  provisionalIds: number[];
  invoiceId: number | null;
};

export function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1;

export function matchProvisionals(invs: MatchInvoice[]): MatchRow[] {
  const rows: MatchRow[] = [];
  const prov = invs.filter((i) => i.stage === "provisional");
  const conf = invs.filter((i) => i.stage === "confirmed");
  const confById = new Map(conf.map((c) => [c.id, c]));
  const usedInvoiceIds = new Set(prov.map((p) => p.settledByInvoiceId).filter((v): v is number => v != null));

  // すでに確定したもの（請求書ごとにまとめる）
  const settledGroups = new Map<number, MatchInvoice[]>();
  for (const p of prov) {
    if (p.settledByInvoiceId == null) continue;
    const g = settledGroups.get(p.settledByInvoiceId) ?? [];
    g.push(p);
    settledGroups.set(p.settledByInvoiceId, g);
  }
  for (const [invoiceId, ps] of settledGroups) {
    const c = confById.get(invoiceId);
    const provisional = ps.reduce((s, p) => s + p.amount, 0);
    rows.push({
      vendorId: ps[0].vendorId,
      vendorName: ps[0].vendorName,
      month: ps.map((p) => p.month).sort()[0],
      invoiceMonth: c?.month ?? null,
      provisional,
      invoice: c ? c.amount : null,
      difference: c ? c.amount - provisional : null,
      status: "settled",
      provisionalIds: ps.map((p) => p.id),
      invoiceId,
    });
  }

  // まだ確定していない仮を、業者ごと・月の順に請求書と組にする
  const vendorIds = [...new Set(prov.filter((p) => p.settledByInvoiceId == null).map((p) => p.vendorId))];
  for (const vendorId of vendorIds) {
    const pBy = new Map<string, MatchInvoice[]>();
    for (const p of prov) {
      if (p.vendorId !== vendorId || p.settledByInvoiceId != null) continue;
      pBy.set(p.month, [...(pBy.get(p.month) ?? []), p]);
    }
    const cBy = new Map<string, MatchInvoice[]>();
    for (const c of conf) {
      if (c.vendorId !== vendorId || usedInvoiceIds.has(c.id)) continue;
      cBy.set(c.month, [...(cBy.get(c.month) ?? []), c]);
    }
    const usedMonths = new Set<string>();
    for (const month of [...pBy.keys()].sort()) {
      const ps = pBy.get(month)!;
      const provisional = ps.reduce((s, p) => s + p.amount, 0);
      let cm: string | null = null;
      if (cBy.has(month) && !usedMonths.has(month)) cm = month;
      else {
        const n = nextMonth(month);
        if (cBy.has(n) && !usedMonths.has(n) && !pBy.has(n)) cm = n;
      }
      const base = { vendorId, vendorName: ps[0].vendorName, month, provisional, provisionalIds: ps.map((p) => p.id) };
      if (!cm) {
        rows.push({ ...base, invoiceMonth: null, invoice: null, difference: null, status: "waiting", invoiceId: null });
        continue;
      }
      usedMonths.add(cm);
      const cs = cBy.get(cm)!;
      const invoice = cs.reduce((s, c) => s + c.amount, 0);
      // 紐づけ先は金額のいちばん大きい請求書（1か月に1枚がふつう）
      const invoiceId = [...cs].sort((a, b) => b.amount - a.amount)[0].id;
      rows.push({
        ...base,
        invoiceMonth: cm,
        invoice,
        difference: invoice - provisional,
        status: near(invoice, provisional) ? "auto" : "review",
        invoiceId,
      });
    }
  }

  const order = { review: 0, waiting: 1, auto: 2, settled: 3 } as const;
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.month.localeCompare(b.month) || a.vendorName.localeCompare(b.vendorName, "ja"));
}
