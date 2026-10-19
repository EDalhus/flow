import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { KaibokDraft, PortCallView } from '../../../shared/api.ts';
import { CATEGORIES, CATEGORY_LABEL, type Category } from '../../../shared/domain/types.ts';
import { api, errorText } from '../lib/api.ts';
import { uploadPhoto } from '../lib/images.ts';
import { fr, timeRange, typeLabel } from '../lib/format.ts';
import { useDeliverQuayLog, useMe, type QuayLogResult } from '../lib/queries.ts';
import { Camera, Check, Close, Mic, Sparkle, Star } from './Icons.tsx';
import { useDictation } from '../lib/dictation.ts';
import { QuayMark } from './ui.tsx';
import { tr, tx } from '../lib/i18n.ts';

// Tekstene er norske og vises med tr().
const ROWS = [
  { key: 'punctuality', label: 'Punktlighet', short: 'punktlighet' },
  { key: 'cooperation', label: 'Samarbeidsvilje (mannskap)', short: 'samarbeidsvilje' },
  { key: 'equipment', label: 'Båtens utstyr / kran', short: 'båtens utstyr' },
] as const;
type RatingKey = (typeof ROWS)[number]['key'];
const WORDS = ['', 'Dårlig', 'Svak', 'Ok', 'Bra', 'Svært bra'];
type Photo = { key: string; preview: string; state: 'laster' | 'ok' | 'feil'; id?: string; error?: string };
const OFF = { background: 'rgba(var(--tint), .05)', color: 'var(--fg)', border: '1px solid rgba(var(--tint), .1)' };

/** Ferdigstilling av anløp. Fast 390 px bredt, som tavla; fyller skjermen på mobil. */
export function KaibokForm({ call, onClose, onDone, fullscreen }: {
  call: PortCallView; onClose: () => void; onDone?: (r: QuayLogResult) => void; fullscreen?: boolean;
}) {
  const [avvik, setAvvik] = useState<'ja' | 'nei' | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [desc, setDesc] = useState('');
  const [r, setR] = useState<Record<RatingKey, number>>({ punctuality: 0, cooperation: 0, equipment: 0 });
  const [note, setNote] = useState('');
  const deliver = useDeliverQuayLog(call.id);
  const me = useMe();
  const result = deliver.data;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  // Rydd forhåndsvisninger når skjemaet lukkes.
  useEffect(() => () => photosRef.current.forEach(p => URL.revokeObjectURL(p.preview)), []);

  const addFiles = (files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, Math.max(0, 20 - photos.length));
    for (const file of list) {
      const key = crypto.randomUUID();
      const preview = URL.createObjectURL(file);
      setPhotos(p => [...p, { key, preview, state: 'laster' }]);
      uploadPhoto(call.id, file)
        .then(up => setPhotos(p => p.map(x => (x.key === key ? { ...x, state: 'ok', id: up.id } : x))))
        .catch(e => setPhotos(p => p.map(x => (x.key === key ? { ...x, state: 'feil', error: errorText(e) } : x))));
    }
  };
  const removePhoto = (ph: Photo) => {
    URL.revokeObjectURL(ph.preview);
    setPhotos(p => p.filter(x => x.key !== ph.key));
    if (ph.id) api(`/photos/${ph.id}`, { method: 'DELETE' }).catch(() => { /* ryddes av nattlig jobb */ });
  };
  const uploading = photos.some(p => p.state === 'laster');
  const uploaded = photos.filter(p => p.state === 'ok' && p.id);

  const ja = avvik === 'ja';
  const missing: string[] = [];
  if (!avvik) missing.push(tr('avvik ja/nei'));
  if (ja && !cats.length && !desc.trim()) missing.push(tr('beskrivelse'));
  for (const row of ROWS) if (!r[row.key]) missing.push(tr(row.short));
  const canSave = !missing.length && !deliver.isPending && !uploading;

  const mine = (r.punctuality + r.cooperation + r.equipment) / 3;
  const save = () => {
    if (!canSave) return;
    deliver.mutate({
      had_deviation: ja, categories: ja ? cats : [], description: ja ? desc.trim() : '',
      ratings: r, boat_note: note.trim() || null, photo_ids: ja ? uploaded.map(p => p.id!) : [],
    });
  };

  return (
    <div className="force-dark" style={{
      width: fullscreen ? '100%' : 390, maxWidth: '100%', height: fullscreen ? '100%' : 844, maxHeight: fullscreen ? undefined : 'calc(100vh - 56px)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', background: '#1A231E', color: 'var(--fg)', fontSize: 16,
    }}>
      <header style={{ flex: 'none', position: 'relative', overflow: 'hidden', padding: '16px 18px 22px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <img src="/kyst.jpg" alt="" style={{ position: 'absolute', left: -620, top: -560, width: 1500, maxWidth: 'none', opacity: .55, pointerEvents: 'none' }} />
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(26,35,30,.2) 0%, rgba(26,35,30,1) 100%)' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, borderRadius: 999, padding: '6px 14px', background: 'rgba(var(--glass-rgb), .55)', border: '1px solid rgba(var(--tint), .12)', backdropFilter: 'blur(12px)' }}>{tr('Kaibok')}</span>
          <button type="button" onClick={onClose} aria-label={tr('Lukk kaibok')} className="icon-btn"
            style={{ width: 48, height: 48, border: '1px solid rgba(var(--tint), .12)', background: 'rgba(var(--glass-rgb), .55)', backdropFilter: 'blur(12px)' }}>
            <Close size={18} />
          </button>
        </div>
        <h1 style={{ position: 'relative', margin: '34px 0 0', fontSize: 36, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.05 }}>{call.boat.name}</h1>
        <span className="n" style={{ position: 'relative', fontSize: 14, color: 'rgba(var(--tint), .65)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {typeLabel(call.type)} · <QuayMark quay={call.quay} compact /> · {timeRange(call)}
        </span>
      </header>

      {!result ? (
        <>
          <div className="scroll-none" style={{ flex: 1, padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
            {me.data?.ai && <TellSection callId={call.id} onDraft={d => {
              setAvvik(d.had_deviation ? 'ja' : 'nei');
              setCats(d.categories.filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c)));
              setDesc(d.description ?? '');
              setR({ punctuality: d.r_punctuality, cooperation: d.r_cooperation, equipment: d.r_equipment });
              setNote(d.boat_note ?? '');
            }} />}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ margin: '0 4px', fontSize: 17, fontWeight: 400 }}>{tr('Var det avvik under anløpet?')}</h2>
              <div role="group" aria-label={tr('Avvik')} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <button type="button" aria-pressed={avvik === 'nei'} onClick={() => setAvvik('nei')}
                  style={{ minHeight: 64, borderRadius: 22, fontSize: 18, cursor: 'pointer', ...(avvik === 'nei' ? { background: '#3DBE6E', color: '#1A231E', border: '1px solid #3DBE6E', fontWeight: 500 } : OFF) }}>{tr('Nei')}</button>
                <button type="button" aria-pressed={ja} onClick={() => setAvvik('ja')}
                  style={{ minHeight: 64, borderRadius: 22, fontSize: 18, cursor: 'pointer', ...(ja ? { background: '#E5484D', color: '#FFFFFF', border: '1px solid #E5484D', fontWeight: 500 } : OFF) }}>{tr('Ja, avvik')}</button>
              </div>

              {ja && (
                <div style={{ borderRadius: 26, padding: 16, background: 'rgba(120,42,38,.3)', border: '1px solid rgba(255,107,94,.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 14, color: 'rgba(var(--tint), .7)' }}>{tr('Hva gjelder det?')}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {CATEGORIES.map(c => {
                        const on = cats.includes(c);
                        return (
                          <button key={c} type="button" aria-pressed={on} onClick={() => setCats(on ? cats.filter(x => x !== c) : [...cats, c])}
                            style={{ minHeight: 44, padding: '0 14px', borderRadius: 999, fontSize: 15, cursor: 'pointer', ...(on ? { background: '#F2F5F3', color: '#1A231E', border: '1px solid #F2F5F3' } : { background: 'rgba(0,0,0,.2)', color: 'var(--fg)', border: '1px solid rgba(var(--tint), .14)' }) }}>
                            {tx(CATEGORY_LABEL[c])}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label htmlFor="kb-desc" style={{ fontSize: 14, color: 'rgba(var(--tint), .7)' }}>{tr('Beskrivelse')}</label>
                    <textarea id="kb-desc" rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder={tr('Hva skjedde, hvor og når?')}
                      style={{ fontSize: 15, color: 'var(--fg)', border: '1px solid rgba(var(--tint), .12)', borderRadius: 18, padding: '12px 14px', resize: 'vertical', minHeight: 92, background: 'rgba(0,0,0,.25)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 14, color: 'rgba(var(--tint), .7)' }}>{tr('Bilder')}</span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                      {photos.map((ph, i) => (
                        <div key={ph.key} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 16, overflow: 'hidden', background: 'rgba(var(--tint), .06)', ...(ph.state === 'feil' ? { outline: '2px solid #E5484D' } : {}) }}>
                          <img src={ph.preview} alt={tr('Avviksbilde {n}', { n: i + 1 })} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: ph.state === 'laster' ? .5 : 1 }} />
                          {ph.state === 'laster' && <span className="loading" style={{ position: 'absolute', left: 8, bottom: 6, fontSize: 12, color: 'var(--fg)' }}>{tr('Laster opp …')}</span>}
                          {ph.state === 'feil' && <span title={ph.error} style={{ position: 'absolute', left: 6, right: 6, bottom: 6, fontSize: 11, color: '#fff', background: 'rgba(229,72,77,.85)', borderRadius: 8, padding: '2px 6px' }}>{tr('Feilet')}</span>}
                          <button type="button" onClick={() => removePhoto(ph)} aria-label={tr('Fjern bilde')} className="icon-btn"
                            style={{ position: 'absolute', top: 6, right: 6, width: 30, height: 30, background: 'rgba(26,35,30,.75)' }}>
                            <Close size={14} strokeWidth={2.4} />
                          </button>
                        </div>
                      ))}
                      {photos.length < 20 && (
                        <label style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 16, border: '1.5px dashed rgba(var(--tint), .35)', background: 'rgba(var(--tint), .03)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, cursor: 'pointer', textAlign: 'center' }}>
                          <Camera size={24} strokeWidth={1.6} />{tr('Ta bilde')}
                          <input type="file" accept="image/*" capture="environment" multiple onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
                        </label>
                      )}
                    </div>
                    <span style={{ fontSize: 13, color: 'rgba(var(--tint), .6)' }} aria-live="polite">
                      {photos.length
                        ? `${photos.length === 1 ? tr('1 bilde') : tr('{n} bilder', { n: photos.length })} · ${uploading ? tr('laster opp …') : photos.some(p => p.state === 'feil') ? tr('noen feilet, fjern og prøv igjen') : tr('lastet opp')}`
                        : tr('Åpner mobilkameraet')}
                    </span>
                  </div>
                </div>
              )}
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ margin: '0 4px', fontSize: 17, fontWeight: 400 }}>{tr('Vurder båten')}</h2>
              <div style={{ borderRadius: 26, background: 'rgba(var(--tint), .04)', border: '1px solid rgba(var(--tint), .07)', overflow: 'hidden' }}>
                {ROWS.map(row => (
                  <div key={row.key} style={{ padding: '14px 16px 10px', display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid rgba(var(--tint), .06)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span>{tr(row.label)}</span>
                      <span style={{ fontSize: 13, color: 'rgba(var(--tint), .6)' }}>{r[row.key] ? tr(WORDS[r[row.key]]) : tr('Ikke satt')}</span>
                    </div>
                    <div role="group" aria-label={tr(row.label)} style={{ display: 'flex', gap: 2, marginLeft: -8 }}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <button key={n} type="button" aria-label={`${tr(row.label)}: ${tr('{n} av 5', { n })}`} aria-pressed={r[row.key] === n} onClick={() => setR({ ...r, [row.key]: n })}
                          style={{ width: 54, height: 50, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Star size={34} fill={n <= r[row.key] ? '#F7B955' : 'rgba(var(--tint), .14)'} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label htmlFor="kb-note" style={{ margin: '0 4px', fontSize: 17 }}>{tr('Notat til båtprofilen')} <span style={{ fontSize: 14, color: 'rgba(var(--tint), .6)' }}>({tr('valgfritt')})</span></label>
              <textarea id="kb-note" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={tr('F.eks. «Mannskapet hjalp til med surring»')}
                style={{ fontSize: 15, color: 'var(--fg)', border: '1px solid rgba(var(--tint), .1)', borderRadius: 20, padding: '12px 14px', resize: 'vertical', minHeight: 76, background: 'rgba(var(--tint), .04)' }} />
            </section>
          </div>

          <div style={{ flex: 'none', padding: '10px 16px 20px', display: 'flex', flexDirection: 'column', gap: 8, background: 'linear-gradient(180deg, rgba(26,35,30,0), #1A231E 30%)' }}>
            {deliver.isError && <div className="error-box" role="alert">{errorText(deliver.error)}</div>}
            {uploading && !missing.length && <span style={{ fontSize: 13, color: 'rgba(var(--tint), .6)', textAlign: 'center' }}>{tr('Venter på at bildene lastes opp …')}</span>}
            {missing.length > 0 && <span style={{ fontSize: 13, color: 'rgba(var(--tint), .6)', textAlign: 'center' }}>{tr('Mangler: {hva}', { hva: missing.join(', ') })}</span>}
            <button type="button" onClick={save} disabled={!canSave} aria-disabled={!canSave}
              style={{ width: '100%', minHeight: 60, borderRadius: 999, border: 'none', fontSize: 17, fontWeight: 500, ...(canSave ? { background: '#F2F5F3', color: '#1A231E', cursor: 'pointer' } : { background: 'rgba(var(--tint), .08)', color: 'rgba(var(--tint), .5)', cursor: 'not-allowed' }) }}>
              {deliver.isPending ? tr('Lagrer …') : tr('Lagre og ferdigstill')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="scroll-none" style={{ flex: 1, padding: '24px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <span style={{ width: 76, height: 76, borderRadius: '50%', background: '#5BD68A', color: '#1A231E', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 12px rgba(91,214,138,.12)' }}>
              <Check size={34} strokeWidth={2.6} />
            </span>
            <h2 style={{ margin: '14px 0 0', fontSize: 28, fontWeight: 300 }} role="status">{tr('Kaibok lagret')}</h2>
            <p style={{ margin: 0, color: 'rgba(var(--tint), .65)', maxWidth: 300 }}>{tr('{båt} er satt til Ferdig. Salg og formann får beskjed i chatten.', { båt: call.boat.name })}</p>
            <dl style={{ margin: '10px 0 0', width: '100%', borderRadius: 26, background: 'rgba(var(--tint), .04)', border: '1px solid rgba(var(--tint), .07)', padding: '4px 18px', display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
              {[
                [tr('Avvik'), result.quay_log.had_deviation ? `${tr('Ja')}${result.quay_log.categories.length ? ` · ${result.quay_log.categories.map(c => tx(CATEGORY_LABEL[c])).join(', ')}` : ''}` : tr('Nei')],
                [tr('Bilder'), String(result.quay_log.photos.length)],
                [tr('Din vurdering'), `${fr(mine)} / 5`],
                [tr('Ny snittrating'), tr('{snitt} (var {før})', { snitt: fr(result.boat.avg_total), før: call.boat.rating_count ? fr(call.boat.avg_total) : '–' })],
                [tr('Flagg'), tx(result.boat.flag_label)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '13px 0', borderBottom: '1px solid rgba(var(--tint), .06)' }}>
                  <dt style={{ color: 'rgba(var(--tint), .6)' }}>{k}</dt>
                  <dd className="n" style={{ margin: 0, textAlign: 'right' }}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div style={{ flex: 'none', padding: '10px 16px 20px' }}>
            <button type="button" onClick={() => (onDone ? onDone(result) : onClose())}
              style={{ width: '100%', minHeight: 60, borderRadius: 999, border: 'none', background: '#F2F5F3', color: '#1A231E', fontSize: 17, fontWeight: 500, cursor: 'pointer' }}>
              {tr('Tilbake til anløp')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Modal rundt skjemaet på desktop (som i Main-tavla). */
/**
 * «Fortell med egne ord»: kaiarbeideren skriver eller snakker inn hva som skjedde, og Claude fyller ut skjemaet
 * (avvik, kategorier, karakterer, beskrivelse og notat). Alt kan justeres før lagring.
 */
function TellSection({ callId, onDraft }: { callId: string; onDraft: (d: KaibokDraft) => void }) {
  const [text, setText] = useState('');
  const [filled, setFilled] = useState(false);
  const dict = useDictation(t => setText(x => (x ? `${x} ${t}` : t)));
  const fill = useMutation({
    mutationFn: () => api<KaibokDraft>('/ask/kaibok', { body: { port_call_id: callId, text } }),
    onSuccess: d => { onDraft(d); setFilled(true); },
  });
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8, borderRadius: 22, padding: 14, background: 'rgba(128,239,222,.06)', border: '1px solid rgba(128,239,222,.25)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}><Sparkle size={15} /> {tr('Fortell med egne ord')}</span>
      <div style={{ position: 'relative' }}>
        <textarea rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={tr('F.eks. «Kom en time for sent, tre paller skadet av båtkrana, ellers greit mannskap»')}
          style={{ width: '100%', fontSize: 15, color: 'var(--fg)', border: '1px solid rgba(var(--tint), .12)', borderRadius: 16, padding: '12px 52px 12px 14px', resize: 'vertical', minHeight: 84, background: 'rgba(0,0,0,.25)' }} />
        {dict.supported && (
          <button type="button" className="icon-btn" onClick={dict.toggle} aria-pressed={dict.on} aria-label={dict.on ? tr('Stopp diktering') : tr('Snakk inn')}
            style={{ position: 'absolute', right: 8, top: 8, width: 38, height: 38, ...(dict.on ? { background: '#E5484D', color: '#fff' } : {}) }}><Mic size={16} /></button>
        )}
      </div>
      {dict.on && <span style={{ fontSize: 13, color: '#FF8A8D' }} className="loading">{tr('Lytter … snakk fritt, trykk igjen for å stoppe')}</span>}
      {dict.error && <span style={{ fontSize: 13, color: 'rgba(var(--tint), .6)' }}>{tr(dict.error)}</span>}
      {fill.isError && <div className="error-box">{errorText(fill.error)}</div>}
      {filled && !fill.isPending && <span style={{ fontSize: 13, color: 'var(--aqua)' }}>{tr('Fylt ut av Claude – sjekk og juster under før du lagrer.')}</span>}
      <button type="button" className="btn" disabled={text.trim().length < 3 || fill.isPending} onClick={() => { dict.stop(); fill.mutate(); }} style={{ minHeight: 44, alignSelf: 'flex-start' }}>
        {fill.isPending ? tr('Fyller ut …') : filled ? tr('Fyll ut på nytt') : tr('Fyll ut skjemaet')}
      </button>
    </section>
  );
}

export function KaibokModal({ call, onClose }: { call: PortCallView; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={tr('Kaibok')} onKeyDown={e => e.key === 'Escape' && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(4,6,8,.55)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '28px 16px', overflowY: 'auto' }}>
      <div style={{ width: 390, maxWidth: '100%', borderRadius: 32, overflow: 'hidden', boxShadow: '0 30px 60px -10px rgba(0,0,0,.7)', flex: 'none' }}>
        <KaibokForm call={call} onClose={onClose} />
      </div>
    </div>
  );
}
