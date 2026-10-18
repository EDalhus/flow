import { useMemo, useState, type ReactNode } from 'react';
import type { MessageView, UserView } from '../../../shared/api.ts';
import { errorText } from '../lib/api.ts';
import { dayRelative, osloTime, serviceDate } from '../lib/format.ts';
import { useMe, useMessages, useSendMessage, useUsers } from '../lib/queries.ts';
import { ArrowRight } from './Icons.tsx';
import { tr, tx } from '../lib/i18n.ts';
import { ROLE_NAMES } from '../lib/format.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Deler meldingsteksten i biter, med @-tagger uthevet (egen tag hvit, andre blå). */
function segments(body: string, users: UserView[], meId?: string): ReactNode[] {
  if (!users.length) return [body];
  const names = [...users].sort((a, b) => b.short_name.length - a.short_name.length);
  const re = new RegExp(`@(${names.map(u => escape(u.short_name)).join('|')})`, 'giu');
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    if (m.index! > last) out.push(body.slice(last, m.index));
    const u = names.find(x => x.short_name.toLowerCase() === m[1].toLowerCase());
    out.push(
      <span key={m.index} style={u?.id === meId ? { background: '#F2F5F3', color: '#1A231E', borderRadius: 6, padding: '0 4px' } : { color: '#80EFDE' }}>{m[0]}</span>,
    );
    last = m.index! + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

export function Chat({ callId, chips = [], variant = 'panel' }: { callId: string; chips?: string[]; variant?: 'panel' | 'mobile' }) {
  const me = useMe();
  const users = useUsers();
  const messages = useMessages(callId);
  const send = useSendMessage(callId);
  const [draft, setDraft] = useState('');
  const byId = useMemo(() => new Map((users.data ?? []).map(u => [u.id, u])), [users.data]);
  const mobile = variant === 'mobile';

  // Enkel @-autofullføring: siste ord som starter med @.
  const at = /(^|\s)@([^\s@]*)$/.exec(draft);
  const suggestions = at
    ? (users.data ?? []).filter(u => u.id !== me.data?.id && u.short_name.toLowerCase().startsWith(at[2].toLowerCase())).slice(0, 5)
    : [];

  const insert = (short: string) => {
    setDraft(d => (at ? d.slice(0, d.length - at[2].length - 1) : d.length && !d.endsWith(' ') ? `${d} ` : d) + `@${short} `);
  };
  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate(body, { onSuccess: () => setDraft('') });
  };

  const list = messages.data ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 10 : 12 }}>
      {mobile && <h3 style={{ margin: '0 4px', fontSize: 14, fontWeight: 400, color: 'var(--fg-62)' }}>{tr('Chat')} · {list.length}</h3>}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: mobile ? 10 : 14 }} aria-live="polite">
        {list.map(m => <Message key={m.id} m={m} author={m.author ? byId.get(m.author.id) : undefined} users={users.data ?? []} meId={me.data?.id} mobile={mobile} />)}
        {messages.isSuccess && !list.length && <li style={{ color: 'var(--fg-62)', fontSize: 14 }}>{tr('Ingen meldinger ennå.')}</li>}
      </ol>

      <div style={{ position: 'relative' }}>
        {suggestions.length > 0 && (
          <div role="listbox" aria-label={tr('Tagg person')} className="glass" style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, padding: 6, borderRadius: 18, display: 'flex', flexDirection: 'column', background: 'rgba(var(--glass-rgb), .95)' }}>
            {suggestions.map(u => (
              <button key={u.id} type="button" role="option" aria-selected="false" className="tab" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => insert(u.short_name)}>
                @{u.short_name} <span className="muted" style={{ fontSize: 12 }}>· {u.title ?? u.roles.map(r => tr(ROLE_NAMES[r])).join(', ')}</span>
              </button>
            ))}
          </div>
        )}
        <div className="pill" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 4px 16px', borderColor: 'rgba(var(--tint), .09)' }}>
          <label htmlFor={`chat-${callId}`} className="sr">{tr('Skriv melding')}</label>
          <input id={`chat-${callId}`} type="text" value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={tr('Melding, @ for å tagge')} autoComplete="off"
            style={{ flex: 1, minWidth: 0, minHeight: mobile ? 48 : 44, background: 'transparent', border: 'none', color: 'var(--fg)', fontSize: mobile ? 16 : 14, outlineOffset: 6 }} />
          <button type="button" className="icon-btn" onClick={submit} aria-label={tr('Send melding')} disabled={!draft.trim() || send.isPending}
            style={{ width: mobile ? 48 : 42, height: mobile ? 48 : 42, background: '#F2F5F3', color: '#1A231E', opacity: draft.trim() ? 1 : .6 }}>
            <ArrowRight size={mobile ? 18 : 16} strokeWidth={2} />
          </button>
        </div>
      </div>
      {send.isError && <div className="error-box" role="alert">{errorText(send.error)}</div>}

      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map(c => (
            <button key={c} type="button" className="btn" onClick={() => insert(c)} style={{ minHeight: mobile ? 44 : 36, fontSize: mobile ? 14 : 13, padding: '0 12px' }}>@{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Message({ m, author, users, meId, mobile }: { m: MessageView; author?: UserView; users: UserView[]; meId?: string; mobile: boolean }) {
  const mine = m.author?.id === meId;
  const mentionsMe = !!meId && m.mentions.includes(meId);
  const time = `${serviceDate(m.created_at) === serviceDate(new Date()) ? '' : `${dayRelative(serviceDate(m.created_at))} `}${osloTime(m.created_at)}`;
  const bubble = m.kind === 'system'
    ? { background: 'rgba(91,214,138,.08)', border: '1px solid rgba(91,214,138,.18)' }
    : mentionsMe ? { background: 'rgba(128,239,222,.16)', border: '1px solid rgba(128,239,222,.25)' }
    : mine ? { background: 'rgba(var(--tint), .1)' } : { background: 'rgba(var(--tint), .05)' };
  const who = m.author?.short_name ?? 'Flow';
  // Meldinger fra Flow selv lagres på norsk og oversettes her; det folk skriver vises som det er.
  const body = m.kind === 'system' || m.body.endsWith('(fra varsel om kollisjon).') ? tx(m.body) : m.body;

  if (mobile) {
    return (
      <li style={{ borderRadius: 20, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 2, ...bubble }}>
        <span style={{ fontSize: 13, color: 'rgba(var(--tint), .6)' }}><span style={{ color: 'var(--fg)' }}>{who}</span> · {time}</span>
        <span style={{ fontSize: 15 }}>{segments(body, users, meId)}</span>
      </li>
    );
  }
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ width: 32, height: 32, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, background: 'rgba(var(--tint), .08)', border: '1px solid rgba(var(--tint), .1)' }}>
        {m.author?.initials ?? 'F'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 500 }}>{who}</span>{' '}
          <span style={{ color: 'rgba(var(--tint), .55)' }}>{author?.title ? `${author.title} · ` : m.kind === 'system' ? `${tr('System')} · ` : ''}{time}</span>
        </span>
        <p style={{ margin: 0, padding: '9px 12px', borderRadius: '4px 16px 16px 16px', fontSize: 14, ...bubble }}>{segments(body, users, meId)}</p>
      </div>
    </li>
  );
}
