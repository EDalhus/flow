import { parseMarkdown, type Inline } from '../../../shared/markdown.ts';

// «Last ned PDF»: rapporten åpnes i et eget vindu med utskriftsvennlig stil, og nettleserens
// utskrift brukes til å lagre som PDF (støtter alle språk og tegn, uten ekstra bibliotek).

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const inline = (l: Inline[]): string => l.map(x =>
  x.t === 'text' ? esc(x.v) : x.t === 'bold' ? `<strong>${inline(x.c)}</strong>` : x.t === 'em' ? `<em>${inline(x.c)}</em>` : x.t === 'code' ? `<code>${esc(x.v)}</code>` : inline(x.c)).join('');

export function markdownToHtml(md: string): string {
  return parseMarkdown(md).map(b =>
    b.t === 'h' ? `<h2>${inline(b.c)}</h2>`
    : b.t === 'p' ? `<p>${b.lines.map(inline).join('<br>')}</p>`
    : `<${b.t}>${b.items.map(i => `<li>${inline(i)}</li>`).join('')}</${b.t}>`).join('\n');
}

export function printReport(title: string, subtitle: string, md: string, footer: string) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 11pt/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #16201B; max-width: 720px; margin: 24px auto; padding: 0 16px; }
  header { border-bottom: 2px solid #0E7C6B; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 22pt; font-weight: 400; margin: 0; }
  .sub { color: #56645D; font-size: 10pt; }
  h2 { font-size: 13pt; margin: 20px 0 6px; color: #0E7C6B; font-weight: 600; }
  p { margin: 6px 0; } ul, ol { margin: 4px 0 8px; padding-left: 20px; } li { margin: 3px 0; }
  strong { font-weight: 600; }
  footer { margin-top: 28px; border-top: 1px solid #D5DDD8; padding-top: 8px; color: #56645D; font-size: 8.5pt; }
</style></head><body>
<header><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></header>
${markdownToHtml(md)}
<footer>${esc(footer)}</footer>
<script>window.onload = () => { window.focus(); window.print(); };</script>
</body></html>`);
  w.document.close();
  return true;
}
