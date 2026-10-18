import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { BoatDetail, BoatPhoto, BoatPhotoCategory } from '../../../shared/api.ts';
import { api, errorText } from '../lib/api.ts';
import { ddmm } from '../lib/format.ts';
import { uploadBoatPhoto } from '../lib/images.ts';
import { useMe } from '../lib/queries.ts';
import { canBoats, canQuayLog } from '../lib/roles.ts';
import { ArrowLeft, ArrowRight, Camera, Close } from './Icons.tsx';
import { tr } from '../lib/i18n.ts';

// Bilder av båten: rampe, sideport, heis, lasterom osv., så alle vet hva de kommer til før båten er ved kai.

const PHOTO_NAMES: Record<BoatPhotoCategory, string> = {
  rampe: 'Rampe', sideport: 'Sideport', heis: 'Heis', lasterom: 'Lasterom', dekk: 'Dekk', kran: 'Kran', annet: 'Annet',
};
/** Navnet på brukerens språk. */
export const PHOTO_CATEGORY_LABEL = new Proxy(PHOTO_NAMES, { get: (o, k: BoatPhotoCategory) => tr(o[k]) });
const CATEGORIES = Object.keys(PHOTO_NAMES) as BoatPhotoCategory[];

export function BoatPhotos({ boat }: { boat: BoatDetail }) {
  const me = useMe();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<BoatPhotoCategory | 'alle'>('alle');
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<BoatPhotoCategory>('rampe');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canAdd = canBoats(me.data) || canQuayLog(me.data);

  const photos = boat.photos.filter(p => filter === 'alle' || p.category === filter);
  const count = (c: BoatPhotoCategory) => boat.photos.filter(p => p.category === c).length;
  const used = CATEGORIES.filter(count);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    try {
      let latest: BoatDetail | null = null;
      const list = [...files];
      for (const [i, f] of list.entries()) {
        setBusy(list.length > 1 ? tr('Laster opp {i} av {n} …', { i: i + 1, n: list.length }) : tr('Laster opp …'));
        latest = await uploadBoatPhoto(boat.id, f, category, caption);
      }
      if (latest) qc.setQueryData(['boat', boat.id], latest);
      setCaption('');
      setAdding(false);
      setFilter('alle');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section aria-labelledby={`bilder-${boat.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h3 id={`bilder-${boat.id}`} style={{ margin: 0, fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>{tr('Bilder av båten')} · {boat.photos.length}</h3>
        {canAdd && !adding && (
          <button type="button" className="tab" onClick={() => setAdding(true)} style={{ minHeight: 32, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Camera size={14} />{tr('Legg til')}
          </button>
        )}
      </div>

      {adding && (
        <div style={{ borderRadius: 18, padding: 12, background: 'rgba(var(--tint), .05)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div role="group" aria-label={tr('Hva viser bildet?')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORIES.map(c => (
              <button key={c} type="button" className="tab" aria-pressed={category === c} onClick={() => setCategory(c)} style={{ minHeight: 32, fontSize: 13, padding: '0 11px' }}>
                {PHOTO_CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          <input className="inp" value={caption} onChange={e => setCaption(e.target.value)} maxLength={300}
            placeholder={tr('Beskrivelse (valgfritt), f.eks. «Rampe akter, 4 m bred»')} aria-label={tr('Beskrivelse av bildet')} />
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => upload(e.target.files)} />
          {error && <div className="error-box">{error}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="btn btn-w" disabled={!!busy} onClick={() => fileRef.current?.click()} style={{ minHeight: 40, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Camera size={16} />{busy ?? tr('Velg eller ta bilde')}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => { setAdding(false); setError(null); }} style={{ minHeight: 40 }}>{tr('Avbryt')}</button>
          </div>
        </div>
      )}

      {used.length > 1 && (
        <div role="group" aria-label={tr('Vis bilder av')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" className="tab" aria-pressed={filter === 'alle'} onClick={() => setFilter('alle')} style={{ minHeight: 30, fontSize: 12, padding: '0 10px' }}>{tr('Alle')}</button>
          {used.map(c => (
            <button key={c} type="button" className="tab" aria-pressed={filter === c} onClick={() => setFilter(c)} style={{ minHeight: 30, fontSize: 12, padding: '0 10px' }}>
              {PHOTO_CATEGORY_LABEL[c]} · {count(c)}
            </button>
          ))}
        </div>
      )}

      {photos.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
          {photos.map((p, i) => (
            <button key={p.id} type="button" onClick={() => setOpen(i)} aria-label={`${PHOTO_CATEGORY_LABEL[p.category]}${p.caption ? `: ${p.caption}` : ''} – ${tr('åpne bildet')}`}
              style={{ position: 'relative', aspectRatio: '4 / 3', padding: 0, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', background: 'rgba(var(--tint), .05)' }}>
              <img src={p.thumb_url ?? p.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <span style={{ position: 'absolute', left: 4, bottom: 4, fontSize: 10.5, padding: '1px 7px', borderRadius: 999, background: 'rgba(var(--chrome-rgb), .8)', color: 'var(--fg)' }}>
                {PHOTO_CATEGORY_LABEL[p.category]}
              </span>
            </button>
          ))}
        </div>
      ) : !adding && (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-62)' }}>
          {tr('Ingen bilder ennå.')}{canAdd ? ` ${tr('Legg til bilder av rampe, sideport, heis eller lasterom, så alle vet hvordan båten ser ut.')}` : ''}
        </p>
      )}

      {open != null && photos[open] && (
        <PhotoViewer photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)}
          canDelete={p => canBoats(me.data) || p.uploaded_by === me.data?.short_name}
          onDelete={async p => {
            const next = await api<BoatDetail>(`/boats/${boat.id}/photos/${p.id}`, { method: 'DELETE' });
            qc.setQueryData(['boat', boat.id], next);
            setOpen(null);
          }} />
      )}
    </section>
  );
}

/** Fullskjerm med bla (piltaster) og sletting. */
function PhotoViewer({ photos, index, onIndex, onClose, canDelete, onDelete }: {
  photos: BoatPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void;
  canDelete: (p: BoatPhoto) => boolean; onDelete: (p: BoatPhoto) => Promise<void>;
}) {
  const p = photos[index];
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onIndex, onClose]);
  useEffect(() => { setConfirm(false); setError(null); }, [index]);

  return (
    <div role="dialog" aria-modal="true" aria-label={tr('Bilde av båten')} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(8,12,10,.92)', color: '#F2F5F3', ['--fg' as string]: '#F2F5F3', ['--fg-62' as string]: 'rgba(242,245,243,.62)', ['--tint' as string]: '242, 245, 243', ['--line' as string]: 'rgba(242,245,243,.12)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 }}>
      <img src={p.url} alt={p.caption ?? PHOTO_CATEGORY_LABEL[p.category]} onClick={e => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 150px)', borderRadius: 12, objectFit: 'contain' }} />
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 760 }}>
        <button type="button" className="icon-btn pill" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label={tr('Forrige bilde')} style={{ width: 40, height: 40 }}><ArrowLeft size={16} /></button>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 200, textAlign: 'center' }}>
          <span>{PHOTO_CATEGORY_LABEL[p.category]}{p.caption ? ` · ${p.caption}` : ''}</span>
          <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>{tr('{i} av {n}', { i: index + 1, n: photos.length })} · {ddmm(p.created_at)}{p.uploaded_by ? ` · ${p.uploaded_by}` : ''}</span>
        </span>
        <button type="button" className="icon-btn pill" disabled={index === photos.length - 1} onClick={() => onIndex(index + 1)} aria-label={tr('Neste bilde')} style={{ width: 40, height: 40 }}><ArrowRight size={16} /></button>
        {canDelete(p) && (confirm
          ? <button type="button" className="btn" style={{ minHeight: 40, color: 'var(--bad-fg)' }} onClick={() => onDelete(p).catch(e => setError(errorText(e)))}>{tr('Slett bildet')}</button>
          : <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => setConfirm(true)}>{tr('Slett …')}</button>)}
        <button type="button" className="icon-btn pill" onClick={onClose} aria-label={tr('Lukk')} style={{ width: 40, height: 40 }}><Close size={15} /></button>
      </div>
      {error && <div className="error-box" onClick={e => e.stopPropagation()}>{error}</div>}
    </div>
  );
}
