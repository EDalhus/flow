export type QuayRef = {
  name: string;
  nickname?: string | null;
  company?: string | null;
};

/** Visningsnavn: kallenavn hvis satt, ellers formelt navn (Kai 1). */
export function quayTitle(q: QuayRef): string {
  const nick = q.nickname?.trim();
  return nick || q.name;
}

/** Kort tekst for lister og kollisjoner: «Ytre» eller «Ytre · Nabo AS». */
export function quayLabel(q: QuayRef): string {
  const title = quayTitle(q);
  return q.company ? `${title} · ${q.company}` : title;
}

export function isOwnQuay(q: { company?: string | null }): boolean {
  return !q.company;
}
