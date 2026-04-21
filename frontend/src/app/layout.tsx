import type { Metadata } from 'next';
import '@/styles/globals.css';
import { ThemeProvider } from '@/lib/theme';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Pelican - Shift Management',
  description: 'Employee scheduling and shift management platform',
  manifest: '/manifest.json',
  themeColor: '#4f46e5',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Pelican',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

// Avoid FOUC: read the saved theme before React hydrates.
// Also register the service worker early so the browser sees the app as installable.
const themeInitScript = `
  try {
    var t = localStorage.getItem('pelican-theme');
    if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function() {});
  }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
