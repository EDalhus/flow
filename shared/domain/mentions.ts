// @-tagging: "@Ola N." matcher brukerens short_name. Lengste navn testes først,
// så "@Per H." ikke stjeler treffet fra en eventuell "@Per Hans.".

export interface MentionUser {
  id: string;
  short_name: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findMentions(body: string, users: MentionUser[]): string[] {
  const sorted = [...users].sort((a, b) => b.short_name.length - a.short_name.length);
  if (!sorted.length) return [];
  const byName = new Map(sorted.map(u => [u.short_name.toLowerCase(), u.id]));
  const re = new RegExp(`@(${sorted.map(u => escape(u.short_name)).join('|')})(?=$|[\\s,.;:!?)])`, 'giu');
  const found = new Set<string>();
  for (const m of body.matchAll(re)) {
    const id = byName.get(m[1].toLowerCase());
    if (id) found.add(id);
  }
  return [...found];
}
