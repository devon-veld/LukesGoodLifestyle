/* /api/paystack/verify — confirm a payment from the success return page.
   Webhooks can lag, so the front-end calls this with the Paystack reference
   after redirect. POST { reference } or GET ?reference=…
   Verifies with Paystack (server-side, using the secret key) and, if paid,
   marks the order paid (idempotent with the webhook). */
import { json, markOrderPaid } from './lib/util.mjs';

const REF_RE = /^[A-Za-z0-9\-.=]{6,100}$/;

export default async (req) => {
  let reference = '';
  if (req.method === 'POST') {
    try { reference = String((await req.json()).reference || ''); } catch { return json({ error: 'bad json' }, 400); }
  } else if (req.method === 'GET') {
    reference = new URL(req.url).searchParams.get('reference') || '';
  } else {
    return json({ error: 'method' }, 405);
  }
  if (!REF_RE.test(reference)) return json({ error: 'bad reference' }, 400);

  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return json({ paid: false, unconfigured: true });

  try {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json().catch(() => ({}));
    const data = body.data || {};
    if (res.ok && body.status && data.status === 'success') {
      const order = await markOrderPaid(reference, {
        orderId: data.metadata?.orderId,
        paymentId: String(data.id),
        amountCents: data.amount,
      });
      return json({ paid: true, orderId: order ? order.id : (data.metadata?.orderId || null) });
    }
    return json({ paid: false, status: data.status || (body.message ? 'error' : 'unknown') });
  } catch (e) {
    console.error('paystack verify exception', e);
    return json({ paid: false, status: 'error' }, 502);
  }
};

export const config = { path: '/api/paystack/verify' };
