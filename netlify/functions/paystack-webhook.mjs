/* /api/paystack/webhook — Paystack payment webhook.
   Register https://lukesgoodlifestyle.com/api/paystack/webhook in the Paystack
   Dashboard (Settings → API Keys & Webhooks). Paystack signs the raw body with
   HMAC-SHA512 using the same secret key (PAYSTACK_SECRET_KEY) and sends it in
   the x-paystack-signature header. On charge.success: mark the order paid,
   decrement stock and send Brevo confirmations (idempotent). */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { json, markOrderPaid, readOrders } from './lib/util.mjs';

function verifySignature(req, rawBody) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return false; // never accept unsigned events
  try {
    const sig = req.headers.get('x-paystack-signature') || '';
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    const a = Buffer.from(sig, 'utf8'), b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch (e) {
    console.error('paystack signature check failed', e);
    return false;
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const rawBody = await req.text();
  if (!verifySignature(req, rawBody)) return json({ error: 'bad signature' }, 401);

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: 'bad json' }, 400); }

  const data = event.data || {};
  if (event.event === 'charge.success' && data.status === 'success') {
    if (data.currency && data.currency !== 'ZAR') {
      console.warn('paystack webhook: unexpected currency', data.currency, data.reference);
    }
    const orderId = data.metadata?.orderId;
    // Amount sanity check (Paystack is authoritative; log mismatch, still mark paid).
    const orders = await readOrders();
    const o = orders.find((x) => x.reference === data.reference) || (orderId && orders.find((x) => x.id === orderId));
    if (o && Math.round(o.total * 100) !== Number(data.amount)) {
      console.warn('paystack webhook: amount mismatch', { order: o.id, expected: Math.round(o.total * 100), got: data.amount });
    }
    await markOrderPaid(data.reference, {
      orderId,
      paymentId: String(data.id),
      amountCents: data.amount,
    });
  }

  return json({ received: true });
};

export const config = { path: '/api/paystack/webhook' };
