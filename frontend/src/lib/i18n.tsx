'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import en from './i18n/en.json';
import es from './i18n/es.json';

// Intentionally-tiny runtime: we ship both dictionaries together (they're small
// JSON files) and switch via context + localStorage.  No router segments, no
// server-side negotiation — the app is SPA-like behind auth, so a client-side
// provider is the least invasive choice and survives the existing route tree
// untouched.

export type Locale = 'en' | 'es';

const DICTS: Record<Locale, Record<string, string>> = { en, es };

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (k) => k,
});

const STORAGE_KEY = 'pelican-locale';

function interpolate(str: string, vars?: Record<string, string | number>) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved === 'en' || saved === 'es') {
        setLocaleState(saved);
        return;
      }
      // Fall back to browser language when no preference saved.  We only
      // honor the first two chars so "es-ES", "es-419" etc. all map to "es".
      const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
      if (nav && nav.toLowerCase().startsWith('es')) setLocaleState('es');
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
      if (typeof document !== 'undefined') document.documentElement.lang = locale;
    } catch {}
  }, [locale]);

  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = DICTS[locale] || DICTS.en;
      // Fall back to the English copy if a key is missing from the active
      // locale, then to the key itself — that way missing translations are
      // always readable instead of blowing up the render.
      const raw = dict[key] ?? DICTS.en[key] ?? key;
      return interpolate(raw, vars);
    },
    [locale]
  );

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

// Convenience: most callers only need `t`.
export function useT() {
  return useContext(I18nContext).t;
}
