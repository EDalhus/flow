import type { CSSProperties } from 'react';
import { tr } from '../lib/i18n.ts';
import { languageName, useTranslated } from '../lib/translate.ts';

/** Liten linje under en oversatt tekst: «Oversatt fra litauisk · Vis original». */
export function TranslatedMark({ t }: { t: ReturnType<typeof useTranslated> }) {
  if (!t.translated) return null;
  return (
    <span style={{ fontSize: 11, color: 'var(--fg-55)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {t.original ? tr('Original') : tr('Oversatt fra {språk}', { språk: languageName(t.source) })} ·
      <button type="button" onClick={t.toggle} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--aqua)', cursor: 'pointer', fontSize: 11 }}>
        {t.original ? tr('Vis oversatt') : tr('Vis original')}
      </button>
    </span>
  );
}

/** Fritekst skrevet av folk (avvik, merknader), automatisk oversatt til leserens språk. */
export function Translated({ text, style, as = 'span' }: { text: string; style?: CSSProperties; as?: 'span' | 'p' }) {
  const t = useTranslated(text);
  const Tag = as;
  return (
    <Tag style={{ ...style, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ whiteSpace: 'pre-wrap' }}>{t.text}</span>
      <TranslatedMark t={t} />
    </Tag>
  );
}
