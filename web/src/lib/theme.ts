import type { Theme } from '../../../shared/api.ts';

// Fargetema: valget lagres på brukeren (prefs.theme) og huskes også i nettleseren,
// så riktig tema settes før appen har hentet brukeren (ingen mørk blink i lyst tema).

const KEY = 'flow-tema';
const dark = window.matchMedia('(prefers-color-scheme: dark)');
let current: Theme = (() => { try { const v = localStorage.getItem(KEY); return v === 'lys' || v === 'system' ? v : 'mork'; } catch { return 'mork'; } })();

const resolve = (t: Theme) => (t === 'system' ? (dark.matches ? 'dark' : 'light') : t === 'lys' ? 'light' : 'dark');
const apply = () => { document.documentElement.dataset.theme = resolve(current); };

export function setTheme(t: Theme) {
  current = t;
  try { localStorage.setItem(KEY, t); } catch { /* ignorer */ }
  apply();
}

/** true når siden vises i lyst tema nå. */
export const isLight = () => document.documentElement.dataset.theme === 'light';

dark.addEventListener('change', () => current === 'system' && apply());
apply();
