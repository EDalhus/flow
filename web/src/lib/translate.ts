import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Translation } from '../../../shared/api.ts';
import { api } from './api.ts';
import { getLang, locale } from './i18n.ts';

// Automatisk oversettelse av fritekst (chat, avvik, merknader) til leserens språk via Claude.
// Tekstene samles i én forespørsel per øyeblikk, og svarene huskes (serveren lagrer dem også),
// så hver tekst oversettes bare én gang per språk.

const cache = new Map<string, Translation>();
const queue = new Set<string>();
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;
/** Slås på når Claude er satt opp (fra /me). */
export const setTranslationEnabled = (on: boolean) => { enabled = on; };

const key = (text: string) => `${getLang()}\u0000${text}`;
const worth = (t: string) => t.trim().length >= 4 && /\p{L}{3,}/u.test(t);

function flush() {
  timer = null;
  const lang = getLang();
  const texts = [...queue].slice(0, 50);
  texts.forEach(t => queue.delete(t));
  if (queue.size) timer = setTimeout(flush, 50);
  api<Translation[]>('/ask/translate', { body: { texts, lang } })
    .then(out => texts.forEach((t, i) => cache.set(`${lang}\u0000${t}`, out[i] ?? { text: null, source_lang: null })))
    .catch(() => texts.forEach(t => cache.set(`${lang}\u0000${t}`, { text: null, source_lang: null })))
    .finally(() => subs.forEach(f => f()));
}

/** Oversettelsen av en tekst, eller undefined mens den hentes (og når den ikke trengs). */
export function useTranslation(text: string | null | undefined): Translation | undefined {
  const t = text?.trim() ?? '';
  const k = key(t);
  useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => cache.get(k));
  useEffect(() => {
    if (!enabled || !worth(t) || cache.has(k) || queue.has(t)) return;
    queue.add(t);
    if (!timer) timer = setTimeout(flush, 60);
  }, [k, t]);
  return worth(t) ? cache.get(k) : undefined;
}

/** Navnet på et språk på leserens språk («litauisk»). */
export function languageName(code: string | null): string {
  if (!code) return '';
  try { return new Intl.DisplayNames([locale()], { type: 'language' }).of(code) ?? code; } catch { return code; }
}

/** Oversatt tekst med «Vis original»; returnerer teksten som skal vises og et lite merke. */
export function useTranslated(text: string | null | undefined) {
  const tr = useTranslation(text);
  const [original, setOriginal] = useState(false);
  const translated = !!tr?.text;
  return { text: translated && !original ? tr!.text! : text ?? '', translated, original, source: tr?.source_lang ?? null, toggle: () => setOriginal(o => !o) };
}
