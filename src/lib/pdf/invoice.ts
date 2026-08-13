import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { formatCents, formatMinutes, fromDateInput } from "@/lib/format";
import type { InvoiceWithDetail } from "@/lib/repositories/invoices";

export interface InvoiceIssuer {
  practiceName: string;
  addressLines: string[];
}

/**
 * Renders an invoice entirely in the browser — no server, and no invoice data sent
 * anywhere to be typeset. Every figure comes from the stored `invoice_lines` rows,
 * which the database computed; nothing is recalculated here.
 */
export function buildInvoicePdf(
  invoice: InvoiceWithDetail,
  issuer: InvoiceIssuer,
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  let y = margin;

  doc.setFont("helvetica", "bold").setFontSize(20);
  doc.text(issuer.practiceName, margin, y);

  doc.setFont("helvetica", "bold").setFontSize(20);
  doc.text("INVOICE", 564 - margin, y, { align: "right" });

  y += 18;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  for (const line of issuer.addressLines) {
    doc.text(line, margin, y);
    y += 12;
  }
  doc.text(invoice.number, 564 - margin, margin + 18, { align: "right" });
  doc.text(
    `Issued ${format(new Date(invoice.issued_at), "d MMM yyyy")}`,
    564 - margin,
    margin + 30,
    { align: "right" },
  );

  y += 18;
  doc.setTextColor(0).setFont("helvetica", "bold").setFontSize(10);
  doc.text("Billed to", margin, y);
  doc.text("Period", 300, y);

  y += 14;
  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text(invoice.profiles?.full_name || "Unknown", margin, y);
  doc.text(
    `${format(fromDateInput(invoice.period_start), "d MMM yyyy")} – ${format(
      fromDateInput(invoice.period_end),
      "d MMM yyyy",
    )}`,
    300,
    y,
  );

  y += 13;
  doc.setTextColor(110).setFontSize(9);
  doc.text(invoice.profiles?.email ?? "", margin, y);
  doc.setTextColor(0);

  const lines = [...invoice.invoice_lines].sort((a, b) =>
    a.worked_on.localeCompare(b.worked_on),
  );

  autoTable(doc, {
    startY: y + 22,
    margin: { left: margin, right: margin },
    head: [["Date", "Shift", "Hours", "Rate", "Amount"]],
    body: lines.map((line) => [
      format(fromDateInput(line.worked_on), "d MMM"),
      line.description,
      formatMinutes(line.minutes),
      `${formatCents(line.rate_cents)}/h`,
      formatCents(line.amount_cents),
    ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [42, 120, 214], halign: "left" },
    columnStyles: {
      0: { cellWidth: 56 },
      2: { halign: "right", cellWidth: 56 },
      3: { halign: "right", cellWidth: 76 },
      4: { halign: "right", cellWidth: 76 },
    },
  });

  // jspdf-autotable records where it stopped on the document instance.
  const afterTable =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
    y + 22;

  let totalsY = afterTable + 22;
  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text("Total hours", 380, totalsY);
  doc.text(formatMinutes(invoice.total_minutes), 564 - margin, totalsY, {
    align: "right",
  });

  totalsY += 18;
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text("Total due", 380, totalsY);
  doc.text(formatCents(invoice.total_cents), 564 - margin, totalsY, { align: "right" });

  totalsY += 30;
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(130);
  doc.text(
    "Staff scheduling record. Contains no patient information.",
    margin,
    totalsY,
  );

  return doc.output("blob");
}
