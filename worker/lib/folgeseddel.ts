import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { BulkOrderView } from '../../shared/api.ts';
import { osloTime, serviceDate } from '../../shared/time.ts';

// Følgeseddel for bulkutlevering (PDF, A4). Alltid på norsk, uansett hvilket språk sjåføren bruker.
// Standardfontene i PDF (WinAnsi) dekker æ, ø og å.

const fmt = (n: number | null) => (n == null ? '–' : n.toFixed(2).replace('.', ','));
const date = (iso: string) => { const d = serviceDate(iso); return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`; };

export async function folgeseddelPdf(o: BulkOrderView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Følgeseddel ${o.delivery_no ?? ''}`.trim());
  doc.setAuthor('Flow · Flatholmen havn');
  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.14, 0.12), muted = rgb(0.4, 0.45, 0.42), line = rgb(0.82, 0.85, 0.83);
  const left = 48, right = 547;
  let y = 790;
  const text = (t: string, x: number, yy: number, size = 10, font: PDFFont = regular, color = ink) => page.drawText(t, { x, y: yy, size, font, color });
  const rule = (yy: number) => page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness: 0.7, color: line });

  text('FØLGESEDDEL', left, y, 20, bold);
  text(`Nr. ${o.delivery_no ?? '–'}`, right - bold.widthOfTextAtSize(`Nr. ${o.delivery_no ?? '–'}`, 14), y + 2, 14, bold);
  y -= 18;
  text('Bulksalt · Flatholmen havn 81B, Ålesund', left, y, 10, regular, muted);
  y -= 26;
  rule(y);
  y -= 22;

  const fields: [string, string][] = [
    ['Kunde', o.customer?.name ?? o.destination ?? '–'],
    ['Prosjektnummer', o.project_no ?? '–'],
    ['SO-nummer', o.so_number ?? '–'],
    ['Dato', date(o.finished_at ?? o.created_at)],
    ['Transportør', o.hauler?.name ?? '–'],
    ['Sjåfør', o.driver_profile ? `${o.driver_profile.name} (+${o.driver_profile.phone})` : o.driver?.name ?? '–'],
    ['Bil (reg.nr.)', o.vehicle ? `${o.vehicle.reg_no}${o.vehicle.description ? ` – ${o.vehicle.description}` : ''}` : o.truck],
    ['Lastet', o.started_at && o.finished_at ? `${osloTime(o.started_at)}–${osloTime(o.finished_at)}` : '–'],
  ];
  for (let i = 0; i < fields.length; i += 2) {
    for (const [j, [k, v]] of fields.slice(i, i + 2).entries()) {
      const x = left + j * 255;
      text(k, x, y, 8.5, regular, muted);
      text(v.slice(0, 48), x, y - 13, 11, bold);
    }
    y -= 36;
  }
  y -= 4;
  rule(y);
  y -= 22;

  const cols = [left, left + 70, left + 230, left + 340, left + 430];
  const head = ['Steg', 'Kvalitet', 'Bestilt (t)', 'Veid (t)', 'Lastet'];
  head.forEach((h, i) => text(h, cols[i], y, 9, bold, muted));
  y -= 8;
  rule(y);
  y -= 18;
  for (const s of o.steps) {
    text(s.target === 'henger' ? 'Henger' : s.target === 'bil' ? 'Bil' : String(s.seq), cols[0], y, 11);
    text(s.quality_name, cols[1], y, 11);
    text(fmt(s.tonnes), cols[2], y, 11);
    text(fmt(s.weighed_tonnes), cols[3], y, 11, bold);
    text(s.started_at && s.finished_at ? `${osloTime(s.started_at)}–${osloTime(s.finished_at)}` : '–', cols[4], y, 11);
    y -= 22;
  }
  rule(y + 8);
  y -= 10;
  text('Sum', cols[1], y, 11, bold);
  text(fmt(o.total_tonnes), cols[2], y, 11, bold);
  text(fmt(o.weighed_tonnes), cols[3], y, 12, bold);
  y -= 30;
  if (o.notes) {
    text('Merknad', left, y, 8.5, regular, muted);
    text(o.notes.slice(0, 95), left, y - 13, 10);
    y -= 36;
  }
  text('Veid tonn er registrert ved utlastingen. Ved avvik, kontakt Flatholmen havn.', left, y, 9, regular, muted);

  signature(page, regular, left, 140, 'Signatur sjåfør', muted, line);
  signature(page, regular, left + 270, 140, 'Signatur utleverer', muted, line);
  text(`Generert av Flow ${date(new Date().toISOString())} ${osloTime(new Date().toISOString())}`, left, 48, 8, regular, muted);
  return doc.save();
}

function signature(page: PDFPage, font: PDFFont, x: number, y: number, label: string, color: ReturnType<typeof rgb>, line: ReturnType<typeof rgb>) {
  page.drawLine({ start: { x, y }, end: { x: x + 220, y }, thickness: 0.7, color: line });
  page.drawText(label, { x, y: y - 14, size: 8.5, font, color });
}
