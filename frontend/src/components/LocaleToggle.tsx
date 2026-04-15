'use client';

import { useI18n } from '@/lib/i18n';
import clsx from 'clsx';

// Small EN | ES pill.  Kept intentionally tiny — a dropdown would be overkill
// for two options and hides the currently-active locale.  Appears both in the
// dashboard top bar and on the login screen so a user who can't read English
// can switch before signing in.
export function LocaleToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden text-[11px] font-medium">
      {(['en', 'es'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={clsx(
            'px-2 py-1 transition uppercase',
            locale === l
              ? 'bg-indigo-600 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
