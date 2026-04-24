// Thin wrapper around Resend so the rest of the codebase doesn't have to know
// which provider we use. In dev (no RESEND_API_KEY set) we just log the email
// to the console — so you can copy the reset link out of the server logs
// without burning real sends against the free tier.
//
// Env vars:
//   RESEND_API_KEY — prod API key from the Resend dashboard.
//   FROM_EMAIL     — e.g. "Pelican <noreply@hr.pelicanshops1.com>". Must be
//                    on a verified domain in Resend.
//   APP_URL        — base URL of the frontend, used to build links in email
//                    templates (e.g. "https://pelicanshops1.com").

const { Resend } = require('resend');

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.FROM_EMAIL || 'Pelican <noreply@hr.pelicanshops1.com>';

// Lazy-init the client so the process doesn't crash at boot when the key is
// missing — we still want the rest of the app to run locally without email.
let client = null;
function getClient() {
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

/**
 * Send a transactional email. Returns { ok: true } on success, { ok: false,
 * error } on failure. Never throws — caller decides whether a delivery
 * failure should surface to the user or just get logged.
 */
async function sendEmail({ to, subject, html, text }) {
  if (!to || !subject || (!html && !text)) {
    return { ok: false, error: 'Missing required email fields' };
  }

  // Dev / staging path — no key configured, log so developers can grab the
  // reset link out of the terminal.
  const c = getClient();
  if (!c) {
    console.log('\n[email:dev] to:', to);
    console.log('[email:dev] subject:', subject);
    console.log('[email:dev] body:\n', text || html.replace(/<[^>]+>/g, ''));
    console.log('');
    return { ok: true, dev: true };
  }

  try {
    const result = await c.emails.send({
      from: fromEmail,
      to,
      subject,
      html,
      text,
    });
    if (result.error) {
      console.error('[email] Resend returned error:', result.error);
      return { ok: false, error: result.error.message || 'Send failed' };
    }
    return { ok: true, id: result.data?.id };
  } catch (err) {
    console.error('[email] Send threw:', err);
    return { ok: false, error: err.message };
  }
}

/** Escape minimal HTML in user-provided strings (names, etc). */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendEmail, esc };
