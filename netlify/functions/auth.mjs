/* /api/auth — admin authentication.
   Actions: status | setup | login | logout | change
   - setup only works while no password exists (first run). If the
     ADMIN_SETUP_CODE env var is set, it must be supplied too.
   - login is rate-limited (8 fails -> 15 min lockout).
   - session: HMAC-signed token in an httpOnly Secure cookie. */
import {
  json, store, hashPassword, verifyPassword, makeSession, requireAuth,
  loginAllowed, recordLogin, sessionCookie,
} from './lib/util.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const action = body.action;
  const rec = await store().get('auth-password', { type: 'json' });
  const hasPassword = !!rec;

  if (action === 'status') {
    return json({ hasPassword, authed: await requireAuth(req) });
  }

  if (action === 'setup') {
    if (hasPassword) return json({ error: 'Password already set. Use login.' }, 403);
    if (process.env.ADMIN_SETUP_CODE && body.setupCode !== process.env.ADMIN_SETUP_CODE) {
      return json({ error: 'Setup code required.' }, 403);
    }
    const pw = String(body.password || '');
    if (pw.length < 10) return json({ error: 'Password must be at least 10 characters.' }, 400);
    await store().setJSON('auth-password', hashPassword(pw));
    const token = await makeSession();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) });
  }

  if (action === 'login') {
    if (!hasPassword) return json({ error: 'No password set yet.' }, 400);
    if (!(await loginAllowed())) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    const ok = verifyPassword(String(body.password || ''), rec);
    await recordLogin(ok);
    if (!ok) return json({ error: 'Incorrect password.' }, 401);
    const token = await makeSession();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) });
  }

  if (action === 'logout') {
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('gone', 0) });
  }

  if (action === 'change') {
    if (!(await requireAuth(req))) return json({ error: 'Not signed in.' }, 401);
    if (!verifyPassword(String(body.current || ''), rec)) return json({ error: 'Current password is incorrect.' }, 401);
    const pw = String(body.next || '');
    if (pw.length < 10) return json({ error: 'New password must be at least 10 characters.' }, 400);
    await store().setJSON('auth-password', hashPassword(pw));
    const token = await makeSession();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) });
  }

  return json({ error: 'unknown action' }, 400);
};

export const config = { path: '/api/auth' };
