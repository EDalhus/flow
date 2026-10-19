import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { MorningBrief as Brief } from '../../../shared/api.ts';
import { api } from '../lib/api.ts';
import { dayRelative } from '../lib/format.ts';
import { tr } from '../lib/i18n.ts';
import { useMe } from '../lib/queries.ts';
import { Close, Sparkle } from './Icons.tsx';
import { Markdown } from './Markdown.tsx';

// Morgenbrief: første gang man åpner Flow hver dag, laget av Claude for rollen (kai, salg, produksjon, admin).
// Lages i bakgrunnen og vises nede til høyre når den er klar; «Lukk» gjør at den ikke vises igjen i dag.

export function MorningBrief() {
  const me = useMe();
  const nav = useNavigate();
  const [closed, setClosed] = useState(false);
  const q = useQuery({ queryKey: ['brief'], queryFn: () => api<{ brief: Brief | null }>('/ask/brief'), staleTime: Infinity, retry: false, enabled: !!me.data });
  const b = q.data?.brief;
  if (!b || closed) return null;
  const close = () => { setClosed(true); api('/ask/brief/seen', { body: {} }).catch(() => {}); };
  const first = me.data?.name.split(' ')[0] ?? '';
  return (
    <aside className="glass scroll brief" role="dialog" aria-labelledby="brief-h">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="eyebrow" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--aqua)' }}><Sparkle size={13} /> {tr('Morgenbrief')} · {dayRelative(b.day)}</span>
          <h2 id="brief-h" style={{ margin: 0, fontSize: 22, fontWeight: 300 }}>{tr('God morgen, {navn}', { navn: first })}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={close} aria-label={tr('Lukk')} style={{ width: 32, height: 32 }}><Close size={14} /></button>
      </div>
      <Markdown text={b.text} go={to => { close(); nav(to); }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="sub" style={{ fontSize: 11 }}>{tr('Laget av Claude fra dataene i Flow.')}</span>
        <button type="button" className="btn" style={{ minHeight: 34, fontSize: 13 }} onClick={close}>{tr('Lukk for i dag')}</button>
      </div>
    </aside>
  );
}
