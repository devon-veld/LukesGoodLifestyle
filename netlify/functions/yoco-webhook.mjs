/* /api/yoco/webhook — Yoco payment webhook.
   Register this URL in the Yoco portal and put the whsec_… secret in
   YOCO_WEBHOOK_SECRET. On payment.succeeded: mark the order paid,
   decrement stock and send Brevo confirmations. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  json, readState, writeState, readOrders, writeOrders, sendEmail, orderEmailHtml,
} from './lib/util.mjs';

function verifySignature(req, rawBody) {
  const secret = process.env.YOCO_WEBHOOK_SECRET;
  if (!secret) return true; // not configured yet — accept but log
  try {
    const id = req.headers.get('webhook-id');
    const ts = req.headers.get('webhook-timestamp');
    const sigHeader = req.headers.get('webhook-signature') || '';
    const signedContent = `${id}.${ts}.${rawBody}`;
    const secretBytes = Buffer.from(secret.split('_')[1], 'base64');
    const expected = createHmac('sha256', secretBytes).update(signedContent).digest('base64');
    return sigHeader.split(' ').some((part) => {
      const sig = part.includes(',') ? part.split(',')[1] : part;
      const a = Buffer.from(sig), b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
  } catch (e) {
    console.error('webhook signature check failed', e);
    return false;
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const rawBody = await req.text();
  if (!verifySignature(req, rawBody)) return json({ error: 'bad signature' }, 401);

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: 'bad json' }, 400); }

  if (event.type === 'payment.succeeded') {
    const meta = event.payload?.metadata || {};
    const orderId = meta.orderId;
    const orders = await readOrders();
    const o = orders.find((x) => x.id === orderId);
    if (o && o.status === 'Awaiting payment') {
      o.status = 'Pending'; // paid, awaiting shipment
      o.paidAt = new Date().toISOString();
      o.paymentId = event.payload?.id;
      await writeOrders(orders);

      // decrement stock now that payment is confirmed
      const state = await readState();
      state.products = state.products.map((p) => {
        const row = o.items.find((r) => r.id === p.id);
        return row ? { ...p, stock: Math.max(0, p.stock - row.qty) } : p;
      });
      await writeState(state);

      await sendEmail({
        to: o.customer.email, toName: o.customer.name,
        subject: `Payment received — order ${o.id} confirmed ✅`,
        html: orderEmailHtml(o, 'Payment received — you legend!', "Your order is confirmed and Luke is packing it. You'll get courier tracking on WhatsApp. Now go smash a workout."),
      });
      await sendEmail({
        to: process.env.ORDER_NOTIFY_EMAIL || 'ripponluke@gmail.com', toName: 'Luke',
        subject: `💰 PAID — order ${o.id} from ${o.customer.name} (R${o.total})`,
        html: orderEmailHtml(o, 'New PAID order!', `${o.customer.name} · ${o.customer.phone} · ${o.customer.email}. Pack it and mark it shipped in the admin.`),
      });
    }
  }

  return json({ received: true });
};

export const config = { path: '/api/yoco/webhook' };
