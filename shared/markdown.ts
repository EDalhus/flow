// Liten markdown-tolker for svarene fra «Spør Flow»: overskrifter, avsnitt, punkt- og nummererte lister,
// og inne i teksten **fet**, *kursiv*, `kode` og [lenker](/sti) – også nøstet, f.eks. **[Polarstrand](/baater?id=…)**.
// Ren funksjon (ingen DOM), så den kan testes.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold' | 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; c: Inline[] }
  | { t: 'p'; lines: Inline[][] }
  | { t: 'ul' | 'ol'; items: Inline[][] };

const LIST = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] | null = null;
  let list: Extract<Block, { t: 'ul' | 'ol' }> | null = null;
  const end = () => { para = null; list = null; };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { end(); continue; }
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (h) { end(); blocks.push({ t: 'h', c: parseInline(h[1]) }); continue; }
    const li = LIST.exec(line);
    if (li) {
      const kind = li[1] ? 'ul' : 'ol';
      if (!list || list.t !== kind) { para = null; list = { t: kind, items: [] }; blocks.push(list); }
      list.items.push(parseInline(li[3]));
      continue;
    }
    // En innrykket linje rett etter et listepunkt hører til punktet.
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1].push({ t: 'text', v: ' ' }, ...parseInline(line.trim())); continue; }
    list = null;
    if (!para) { para = []; blocks.push({ t: 'p', lines: para }); }
    para.push(parseInline(line.trim()));
  }
  return blocks;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\*\*(.+?)\*\*/.exec(rest)) || (m = /^__(.+?)__/.exec(rest))) { flush(); out.push({ t: 'bold', c: parseInline(m[1]) }); i += m[0].length; continue; }
    if ((m = /^`([^`]+)`/.exec(rest))) { flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length; continue; }
    if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) { flush(); out.push({ t: 'link', href: m[2], c: parseInline(m[1]) }); i += m[0].length; continue; }
    if ((m = /^\*(?!\s)([^*]+?)\*/.exec(rest)) || (m = /^_(?!\s)([^_]+?)_(?![\p{L}\d])/u.exec(rest))) {
      // Ikke kursiv midt i et ord (f.eks. b_polarstrand).
      if (!/[\p{L}\d]/u.test(s[i - 1] ?? '')) { flush(); out.push({ t: 'em', c: parseInline(m[1]) }); i += m[0].length; continue; }
    }
    buf += s[i];
    i++;
  }
  flush();
  return out;
}

/** Bare lenker inn i Flow (relativ sti) er klikkbare; alt annet vises som tekst. */
export const isInternalHref = (href: string) => href.startsWith('/') && !href.startsWith('//');

/** «Valg: Ja | Nei | Litt forsinket» på siste linje blir knapper (Claude legger det til ved oppfølgingsspørsmål). */
const CHOICES = /^\s*\**(?:valg|options|choices|pasirinkimai|val|valmöjligheter|valkostir|svarmuligheder)\**\s*:\s*\**\s*(.+)$/i;
export function splitChoices(answer: string): { text: string; choices: string[] } {
  const lines = answer.trimEnd().split('\n');
  const m = CHOICES.exec(lines[lines.length - 1] ?? '');
  if (!m) return { text: answer, choices: [] };
  return { text: lines.slice(0, -1).join('\n').trimEnd(), choices: m[1].split('|').map(x => x.trim().replace(/^[«"]|[»"]$/g, '')).filter(Boolean).slice(0, 6) };
}
