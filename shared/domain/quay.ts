/** Visningsnavn: «Kai 1» eller «Kai 1 · Nabo AS». */
export function quayLabel(q: { name: string; company?: string | null }): string {
  return q.company ? `${q.name} · ${q.company}` : q.name;
}
