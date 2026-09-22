/* Shared helpers for the Luke's Good Lifestyle backend (Netlify Functions v2). */
import { getStore } from '@netlify/blobs';
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';

/* Local-test store: set LGL_LOCAL_STORE=1 to swap Netlify Blobs for an
   in-memory Map (same subset of the API the functions use). */
const localData = new Map();
const localStore = {
  async get(key, opts) {
    if (!localData.has(key)) return null;
    const v = localData.get(key);
    return opts && opts.type === 'json' ? JSON.parse(v) : v;
  },
  async set(key, value) { localData.set(key, value); },
  async setJSON(key, obj) { localData.set(key, JSON.stringify(obj)); },
};

// Strong consistency: reads always see the latest write (auth, orders, stock).
export const store = () =>
  process.env.LGL_LOCAL_STORE === '1' ? localStore : getStore({ name: 'lgl', consistency: 'strong' });

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

export const SITE_URL = (process.env.URL || 'https://lukesgoodlifestyle.com').replace(/\/$/, '');

/* ---------------- Default catalog (seed) ---------------- */
export const DEFAULT_STATE = {
  products: [
    { id: 'gold', name: "Luke's Good Gold", tag: 'Golden paste capsules · 30 servings', price: 399, sale: 299, saleOn: true, stock: 42 },
    { id: 'gg', name: 'Eterna™ GG', tag: 'Geranylgeraniol 150mg · 30 soft gels', price: 450, sale: null, saleOn: false, stock: 18 },
  ],
  special: { active: true, text: "WINTER SALE, Luke's Good Gold now R299 (was R399). Limited stock!" },
  // Flat courier fee, waived once an order reaches freeOver (in Rand).
  shipping: { fee: 99, freeOver: 600 },
  // Quantity deals on one product. tiers are total prices for that many units.
  bundle: {
    active: true,
    productId: 'gold',
    freeShippingFromQty: 2,
    tiers: [{ qty: 2, price: 549 }, { qty: 3, price: 749 }, { qty: 4, price: 999 }],
  },
};

/* Repairs product text that lost characters (shows as U+FFFD) before this
   data was written. Only the built-in products can be restored exactly, from
   DEFAULT_STATE; anything else is left for the admin to retype. */
function repairProductText(state) {
  let changed = false;
  for (const p of state.products || []) {
    const base = DEFAULT_STATE.products.find((d) => d.id === p.id);
    if (!base) continue;
    for (const field of ['name', 'tag']) {
      if (typeof p[field] === 'string' && p[field].includes('�')) {
        p[field] = base[field];
        changed = true;
      }
    }
  }
  return changed;
}

export async function readState() {
  const s = await store().get('state', { type: 'json' });
  if (!s || !s.products) return structuredClone(DEFAULT_STATE);
  if (repairProductText(s)) {
    try { await store().setJSON('state', s); } catch (e) { console.error('repair write failed', e.message); }
  }
  // State written before shipping/bundles existed still needs both.
  if (!s.shipping) s.shipping = structuredClone(DEFAULT_STATE.shipping);
  if (!s.bundle) s.bundle = structuredClone(DEFAULT_STATE.bundle);
  return s;
}
export async function writeState(state) { await store().setJSON('state', state); }

export async function readOrders() {
  return (await store().get('orders', { type: 'json' })) || [];
}
export async function writeOrders(orders) { await store().setJSON('orders', orders); }

export const effectivePrice = (p) => (p.saleOn && p.sale ? p.sale : p.price);

/* Server-side cart pricing (never trust client totals).

   Bundle tiers give a total price for a quantity of one product (2 bags for
   R549, and so on). For any quantity we charge the cheapest combination of
   tiers and singles, so a customer can never pay less by splitting the order.
   A cart gets either the bundle saving or the Gold Stack discount, whichever
   is larger, never both. Shipping is a flat fee, waived when the bundle
   qualifies or the order reaches the free-shipping threshold. */
export function priceCart(cart, products, state = {}) {
  const shipCfg = state.shipping || DEFAULT_STATE.shipping;
  const bundleCfg = state.bundle || DEFAULT_STATE.bundle;

  const rows = [];
  for (const c of cart || []) {
    const p = products.find((x) => x.id === c.id);
    const qty = Math.max(1, Math.min(50, parseInt(c.qty, 10) || 1));
    if (!p) continue;
    rows.push({ id: p.id, name: p.name, qty, unit: effectivePrice(p) });
  }
  const subtotal = rows.reduce((t, r) => t + r.unit * r.qty, 0);

  // Cheapest combination of tiers for the bundle product.
  const bRow = bundleCfg && bundleCfg.active ? rows.find((r) => r.id === bundleCfg.productId) : null;
  const tiers = ((bundleCfg && bundleCfg.tiers) || []).filter((t) => t.qty >= 2 && t.price > 0);
  let bundleSaving = 0;
  if (bRow && tiers.length) {
    const best = [0];
    for (let n = 1; n <= bRow.qty; n++) {
      let cheapest = best[n - 1] + bRow.unit;
      for (const t of tiers) {
        if (t.qty <= n) cheapest = Math.min(cheapest, best[n - t.qty] + t.price);
      }
      best[n] = cheapest;
    }
    bundleSaving = Math.max(0, bRow.unit * bRow.qty - best[bRow.qty]);
  }

  const hasStack = rows.some((r) => r.id === 'gold') && rows.some((r) => r.id === 'gg');
  const stackSaving = hasStack ? 100 : 0;

  const useBundle = bundleSaving > 0 && bundleSaving >= stackSaving;
  const discount = useBundle ? bundleSaving : stackSaving;
  const discountLabel = useBundle ? 'Bundle deal' : (stackSaving ? 'Gold Stack discount' : '');
  const afterDiscount = Math.max(0, subtotal - discount);

  const qtyForFreeShip = bRow ? bRow.qty : 0;
  const freeFromQty = Number(bundleCfg && bundleCfg.freeShippingFromQty) || 0;
  const freeOver = Number(shipCfg && shipCfg.freeOver) || 0;
  const freeShipping = (freeFromQty > 0 && qtyForFreeShip >= freeFromQty)
    || (freeOver > 0 && afterDiscount >= freeOver);
  const shipping = rows.length === 0 || freeShipping ? 0 : Math.max(0, Number(shipCfg && shipCfg.fee) || 0);

  return { rows, subtotal, discount, discountLabel, shipping, freeShipping, total: afterDiscount + shipping };
}

/* ---------------- Password hashing (scrypt) ---------------- */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
export function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const hash = scryptSync(password, rec.salt, 64);
  const stored = Buffer.from(rec.hash, 'hex');
  return hash.length === stored.length && timingSafeEqual(hash, stored);
}

/* ---------------- Sessions (HMAC-signed, httpOnly cookie) ---------------- */
async function authSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  let sec = await store().get('auth-secret');
  if (!sec) {
    sec = randomBytes(32).toString('hex');
    await store().set('auth-secret', sec);
  }
  return sec;
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export async function makeSession(days = 7) {
  const payload = JSON.stringify({ exp: Date.now() + days * 86400_000, v: 1 });
  const secret = await authSecret();
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return b64u(payload) + '.' + sig;
}
export async function checkSession(token) {
  try {
    if (!token) return false;
    const [p, sig] = token.split('.');
    const payload = Buffer.from(p, 'base64url').toString();
    const secret = await authSecret();
    const expect = createHmac('sha256', secret).update(payload).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    return JSON.parse(payload).exp > Date.now();
  } catch { return false; }
}
export function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
export const sessionCookie = (token, maxAge = 7 * 86400) =>
  `lgl_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

export async function requireAuth(req) {
  return checkSession(getCookie(req, 'lgl_admin'));
}

/* ---------------- Login rate limiting (per client IP) ----------------
   Keyed per IP so an attacker guessing passwords locks only themselves
   out — Luke can still sign in from his own connection. */
function clientKey(req) {
  const ip = req.headers.get('x-nf-client-connection-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown';
  return 'auth-fails:' + ip;
}
export async function loginAllowed(req) {
  const f = (await store().get(clientKey(req), { type: 'json' })) || { count: 0, until: 0 };
  return Date.now() >= (f.until || 0);
}
export async function recordLogin(req, success) {
  const key = clientKey(req);
  let f = (await store().get(key, { type: 'json' })) || { count: 0, until: 0 };
  if (success) f = { count: 0, until: 0 };
  else {
    f.count = (f.count || 0) + 1;
    if (f.count >= 8) { f.until = Date.now() + 15 * 60_000; f.count = 0; }
  }
  await store().setJSON(key, f);
}

/* ---------------- Transactional email (SMTP) ----------------
   Sent through the domain's own mail host (GoDaddy) as luke@lukesgoodlifestyle.com.
   The domain's SPF record only authorises GoDaddy, so the From address must be
   the authenticated mailbox. Never throws: a failed email must not break a
   checkout or a payment webhook. */
export const NOTIFY_EMAIL = process.env.ORDER_NOTIFY_EMAIL || 'luke@lukesgoodlifestyle.com';
const SMTP_USER = process.env.SMTP_USER || 'luke@lukesgoodlifestyle.com';

let transporter = null;
function mailer() {
  if (!process.env.SMTP_PASS) return null;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtpout.secureserver.net',
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: { user: SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 12000,
    });
  }
  return transporter;
}

const htmlToText = (h) => String(h)
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h2|tr|div)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();

export async function sendEmail({ to, toName, subject, html, replyTo }) {
  const t = mailer();
  if (!t || !to) return { skipped: true };
  try {
    const info = await t.sendMail({
      from: { name: "Luke's Good Lifestyle", address: SMTP_USER },
      to: toName ? { name: toName, address: to } : to,
      replyTo,
      subject,
      html,
      text: htmlToText(html),
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error('email failed', { to, subject, error: e.message });
    return { ok: false, error: e.message };
  }
}

export const R = (n) => 'R' + Number(n || 0).toLocaleString('en-ZA');

/* Escape user-supplied strings before interpolating into email HTML. */
export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function orderEmailHtml(order, heading, intro) {
  const rows = order.items.map((i) =>
    `<tr><td style="padding:6px 12px 6px 0">${esc(i.name)} × ${i.qty}</td><td align="right" style="padding:6px 0">${R(i.unit * i.qty)}</td></tr>`).join('');
  const disc = order.discount ? `<tr><td style="padding:6px 12px 6px 0;color:#777">${esc(order.discountLabel || 'Discount')}</td><td align="right" style="padding:6px 0;color:#777">−${R(order.discount)}</td></tr>` : '';
  const ship = `<tr><td style="padding:6px 12px 6px 0;color:#777">Delivery</td><td align="right" style="padding:6px 0;color:#777">${order.shipping ? R(order.shipping) : 'FREE'}</td></tr>`;
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#131313">
    <div style="background:#131313;color:#F2E635;padding:18px 24px;border-radius:12px 12px 0 0;font-size:20px;font-weight:800">LUKE'S GOOD LIFESTYLE</div>
    <div style="border:1px solid #e5e5e5;border-top:0;padding:24px;border-radius:0 0 12px 12px">
      <h2 style="margin:0 0 8px">${esc(heading)}</h2>
      <p style="margin:0 0 16px;color:#555">${esc(intro)}</p>
      <p style="margin:0 0 4px"><strong>Order ${order.id}</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}${disc}${ship}
        <tr><td style="padding:10px 12px 0 0;border-top:1px solid #eee"><strong>Total</strong></td><td align="right" style="padding:10px 0 0;border-top:1px solid #eee"><strong>${R(order.total)}</strong></td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:13px;color:#777">Delivery to: ${esc(order.customer.address || '-')}<br>
      Questions? WhatsApp Luke on 073 028 3066.</p>
    </div>
  </div>`;
}

/* ---------------- Mark an order paid (Paystack) ----------------
   Idempotent: called by both the Paystack webhook and /api/paystack/verify,
   whichever arrives first. Finds the order by its Paystack reference (falling
   back to paymentInfo.orderId), and only acts if it is still 'Awaiting
   payment'. Sets status 'Pending' (paid, awaiting shipment), decrements stock
   and sends the two order emails. Returns the order, or null if not found. */
export async function markOrderPaid(reference, paymentInfo = {}) {
  const orders = await readOrders();
  let o = reference ? orders.find((x) => x.reference === reference) : null;
  if (!o && paymentInfo.orderId) o = orders.find((x) => x.id === paymentInfo.orderId);
  if (!o) return null;
  if (o.status !== 'Awaiting payment') return o; // already handled

  o.status = 'Pending';
  o.paidAt = new Date().toISOString();
  o.paymentId = paymentInfo.paymentId || null;
  o.paidVia = 'paystack';
  if (paymentInfo.amountCents != null) o.amountPaid = Number(paymentInfo.amountCents) / 100;
  await writeOrders(orders);

  // decrement stock now that payment is confirmed
  const state = await readState();
  state.products = state.products.map((p) => {
    const row = o.items.find((r) => r.id === p.id);
    return row ? { ...p, stock: Math.max(0, p.stock - row.qty) } : p;
  });
  await writeState(state);

  await Promise.all([
    sendEmail({
      to: o.customer.email, toName: o.customer.name,
      subject: `Payment received — order ${o.id} confirmed ✅`,
      html: orderEmailHtml(o, 'Payment received — you legend!', "Your order is confirmed and Luke is packing it. You'll get courier tracking on WhatsApp. Now go smash a workout."),
    }),
    sendEmail({
      to: NOTIFY_EMAIL, toName: 'Luke', replyTo: o.customer.email,
      subject: `💰 PAID — order ${o.id} from ${o.customer.name} (R${o.total})`,
      html: orderEmailHtml(o, 'New PAID order!', `${o.customer.name} · ${o.customer.phone} · ${o.customer.email}. Pack it and mark it shipped in the admin.`),
    }),
  ]);
  return o;
}
