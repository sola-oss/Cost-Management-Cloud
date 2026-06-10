import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

interface InvoiceItem {
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxRate: number;
  amount: number;
}

interface Invoice {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  clientName: string;
  clientAddress: string;
  projectName: string;
  invoiceRegistrationNumber: string;
  taxExcludedAmount10: number;
  taxAmount10: number;
  taxExcludedAmount8: number;
  taxAmount8: number;
  taxExcludedTotal: number;
  taxTotal: number;
  totalAmount: number;
  notes: string;
}

interface CompanySettings {
  companyName: string;
  postalCode: string;
  address: string;
  tel: string;
  fax: string;
  invoiceRegistrationNumber: string;
  representativeName: string;
  bankName: string;
  bankBranch: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

function fmt(v: number): string {
  return "¥" + Math.round(v).toLocaleString("ja-JP");
}

function fmtDate(d: string | null): string {
  if (!d) return "";
  return d.replace(/-/g, "/");
}

function toBytesInt32(n: number) {
  const arr = new Uint8Array(4);
  arr[0] = (n >> 24) & 0xff;
  arr[1] = (n >> 16) & 0xff;
  arr[2] = (n >> 8) & 0xff;
  arr[3] = n & 0xff;
  return arr;
}

let _fontCache: ArrayBuffer | null = null;
async function loadNotoSansJP(): Promise<ArrayBuffer | null> {
  if (_fontCache) return _fontCache;
  try {
    // アプリに同梱した日本語フォント（OTF）を埋め込む。外部CDN依存をなくし、オフラインでも生成できる
    const url = `${import.meta.env.BASE_URL}fonts/NotoSansJP-Regular.otf`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch font");
    _fontCache = await res.arrayBuffer();
    return _fontCache;
  } catch {
    return null;
  }
}

const TEAL = rgb(0, 0.502, 0.471);
const DARK = rgb(0.118, 0.118, 0.118);
const GRAY = rgb(0.4, 0.4, 0.4);
const WHITE = rgb(1, 1, 1);
const LIGHT_GRAY = rgb(0.96, 0.96, 0.96);

export async function generateInvoicePDF(
  invoice: Invoice,
  items: InvoiceItem[],
  company: CompanySettings
): Promise<void> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await loadNotoSansJP();
  let font: Awaited<ReturnType<typeof pdfDoc.embedFont>>;
  let boldFont: Awaited<ReturnType<typeof pdfDoc.embedFont>>;

  if (fontBytes) {
    font = await pdfDoc.embedFont(fontBytes);
    boldFont = font;
  } else {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  const page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();
  const margin = 40;

  let y = height - margin;

  const drawText = (
    text: string,
    x: number,
    yPos: number,
    options: {
      size?: number;
      color?: ReturnType<typeof rgb>;
      bold?: boolean;
      align?: "left" | "right" | "center";
      maxWidth?: number;
    } = {}
  ) => {
    const { size = 9, color = DARK, bold = false, align = "left", maxWidth } = options;
    const f = bold ? boldFont : font;
    let drawX = x;
    if (align === "right") {
      const tw = f.widthOfTextAtSize(text, size);
      drawX = x - tw;
    } else if (align === "center") {
      const tw = f.widthOfTextAtSize(text, size);
      drawX = x - tw / 2;
    }
    page.drawText(text, { x: drawX, y: yPos, size, font: f, color, maxWidth });
  };

  const drawRect = (
    x: number,
    yPos: number,
    w: number,
    h: number,
    fillColor: ReturnType<typeof rgb>,
    borderColor?: ReturnType<typeof rgb>
  ) => {
    page.drawRectangle({
      x,
      y: yPos,
      width: w,
      height: h,
      color: fillColor,
      borderColor,
      borderWidth: borderColor ? 0.5 : 0,
    });
  };

  const drawLine = (x1: number, y1: number, x2: number, y2: number, color = GRAY) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color });
  };

  // Title
  drawText("請求書", width / 2, y - 12, { size: 20, bold: true, align: "center", color: DARK });
  y -= 28;

  drawLine(margin, y, width - margin, y, TEAL);
  y -= 10;

  // Invoice meta (right)
  drawText(`請求番号: ${invoice.invoiceNumber}`, width - margin, y, { align: "right", size: 8, color: GRAY });
  y -= 13;
  drawText(`請求日: ${fmtDate(invoice.invoiceDate)}`, width - margin, y, { align: "right", size: 8, color: GRAY });
  if (invoice.dueDate) {
    y -= 12;
    drawText(`入金期限: ${fmtDate(invoice.dueDate)}`, width - margin, y, { align: "right", size: 8, color: GRAY });
  }

  // Client (left)
  const clientY = height - margin - 40;
  drawText(`${invoice.clientName || "請求先"}  御中`, margin, clientY, { size: 12, bold: true });
  if (invoice.clientAddress) {
    drawText(invoice.clientAddress, margin, clientY - 15, { size: 8, color: GRAY });
  }
  if (invoice.projectName) {
    drawText(`工事名: ${invoice.projectName}`, margin, clientY - 28, { size: 8, color: GRAY });
  }

  // Company (right)
  const compRightX = width - margin;
  let compY = height - margin - 56;
  drawText(company.companyName, compRightX, compY, { align: "right", size: 10, bold: true });
  compY -= 14;
  if (company.address) {
    drawText(company.address, compRightX, compY, { align: "right", size: 8, color: GRAY });
    compY -= 11;
  }
  if (company.tel) {
    drawText(`TEL: ${company.tel}`, compRightX, compY, { align: "right", size: 8, color: GRAY });
    compY -= 11;
  }
  if (invoice.invoiceRegistrationNumber) {
    drawText(`登録番号: ${invoice.invoiceRegistrationNumber}`, compRightX, compY, { align: "right", size: 8, color: TEAL });
    compY -= 11;
  }

  y = Math.min(clientY - 45, compY - 10);

  // Total amount box
  drawRect(margin, y - 18, 240, 24, TEAL);
  drawText(`請求金額（税込）: ${fmt(invoice.totalAmount)}`, margin + 8, y - 10, { size: 11, bold: true, color: WHITE });
  y -= 30;

  // Items table header
  const tableY = y;
  const colWidths = [24, 170, 40, 32, 60, 36, 68, 30];
  const cols = ["#", "品名・内容", "数量", "単位", "単価", "税率", "金額", ""];
  const tableW = width - margin * 2;

  drawRect(margin, tableY - 18, tableW, 20, TEAL);
  let colX = margin;
  for (let i = 0; i < cols.length - 1; i++) {
    const xPos = i === 0 ? colX + 2 : i <= 1 ? colX + 4 : colX;
    const align = i >= 2 ? "right" : "left";
    const textX = align === "right" ? colX + colWidths[i] - 3 : xPos;
    drawText(cols[i], textX, tableY - 13, { size: 8, color: WHITE, bold: true, align });
    colX += colWidths[i];
  }

  y = tableY - 20;

  items.forEach((it, idx) => {
    const rowH = 17;
    if (idx % 2 === 1) {
      drawRect(margin, y - rowH + 2, tableW, rowH, LIGHT_GRAY);
    }
    colX = margin;
    const row = [
      String(idx + 1),
      it.itemName,
      String(it.quantity),
      it.unit,
      fmt(it.unitPrice),
      `${it.taxRate}%`,
      fmt(it.amount),
    ];
    row.forEach((cell, ci) => {
      const isRight = ci >= 2;
      const tx = isRight ? colX + colWidths[ci] - 3 : colX + 3;
      drawText(cell, tx, y - 11, { size: 8, align: isRight ? "right" : "left", maxWidth: colWidths[ci] - 4 });
      colX += colWidths[ci];
    });
    y -= rowH;
  });

  drawLine(margin, y, width - margin, y);
  y -= 14;

  // Tax summary
  const taxX = width - margin - 160;
  const taxRightX = width - margin;

  const taxRows: [string, string][] = [];
  if (invoice.taxExcludedAmount10 > 0) {
    taxRows.push(["10%対象額", fmt(invoice.taxExcludedAmount10)]);
    taxRows.push(["消費税（10%）", fmt(invoice.taxAmount10)]);
  }
  if (invoice.taxExcludedAmount8 > 0) {
    taxRows.push(["8%対象額（軽減税率）", fmt(invoice.taxExcludedAmount8)]);
    taxRows.push(["消費税（8%）", fmt(invoice.taxAmount8)]);
  }
  taxRows.push(["税抜合計", fmt(invoice.taxExcludedTotal)]);
  taxRows.push(["消費税合計", fmt(invoice.taxTotal)]);

  for (const [label, val] of taxRows) {
    drawText(label, taxX, y, { size: 8, color: GRAY });
    drawText(val, taxRightX, y, { size: 8, align: "right" });
    y -= 13;
  }

  drawLine(taxX, y + 8, taxRightX, y + 8, TEAL);
  y -= 6;
  drawText("税込合計", taxX, y, { size: 10, bold: true, color: TEAL });
  drawText(fmt(invoice.totalAmount), taxRightX, y, { size: 10, bold: true, align: "right", color: TEAL });
  y -= 20;

  // Notes
  if (invoice.notes) {
    drawLine(margin, y + 4, width - margin, y + 4, LIGHT_GRAY);
    y -= 8;
    drawText("備考:", margin, y, { size: 8, color: GRAY });
    drawText(invoice.notes, margin + 28, y, { size: 8, maxWidth: (width - margin * 2) / 2 });
    y -= 16;
  }

  // Bank info
  if (company.bankName) {
    drawLine(margin, y + 4, width - margin, y + 4, LIGHT_GRAY);
    y -= 8;
    const bankText = `お振込先: ${company.bankName} ${company.bankBranch} ${company.bankAccountType} ${company.bankAccountNumber} ${company.bankAccountName}`;
    drawText(bankText, margin, y, { size: 8, color: GRAY, maxWidth: width - margin * 2 });
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${invoice.invoiceNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
