/* /api/checkout — create an order and start payment.
   POST { cart:[{id,qty}], customer:{name, phone, address, email} }

   With YOCO_SECRET_KEY set:   creates a Yoco hosted checkout and returns
                               { redirectUrl } — customer pays on Yoco, the
                               webhook marks the order paid.
   Without it (not yet live):  records the order as an unpaid manual order
                               ("Pending · EFT/WhatsApp") and sends the emails,
                               returning { demo:true } so the site still works. */
import {
  json, store, readState, writeState, readOrders, writeOrders, priceCart,
  sendEmail, orderEmailHtml, SITE_URL,
} from './lib/util.mjs';

async function nextOrderNumber() {
  const n = (await store().get('order-counter', { type: 'json' })) || 1043;
  await store().setJSON('order-counter', n + 1);
  return '#' + n;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const c = body.customer || {};
  const customer = {
    name: String(c.name || '').slice(0, 120).trim(),
    phone: String(c.phone || '').slice(0, 40).trim(),
    address: String(c.address || '').slice(0, 400).trim(),
    email: String(c.email || '').slice(0, 200).trim().toLowerCase(),
  };
  if (!customer.name || !customer.phone || !customer.address) {
    return json({ error: 'Please fill in your name, WhatsApp number and address.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    return json({ error: 'Please enter a valid email address for your order confirmation.' }, 400);
  }

  const state = await readState();
  const priced = priceCart(body.cart, state.products);
  if (!priced.rows.length) return json({ error: 'Your cart is empty.' }, 400);

  const order = {
    id: await nextOrderNumber(),
    createdAt: new Date().toISOString(),
    status: 'Awaiting payment',
    customer,
    items: priced.rows,
    subtotal: priced.subtotal,
    discount: priced.discount,
    total: priced.total,
  };

  const yocoKey = process.env.YOCO_SECRET_KEY;

  if (yocoKey) {
    /* ---- Real Yoco hosted checkout ---- */
    try {
      const res = await fetch('https://payments.yoco.com/api/checkouts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${yocoKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(order.total * 100),   // cents
          currency: 'ZAR',
          successUrl: `${SITE_URL}/?payment=success&order=${encodeURIComponent(order.id)}`,
          cancelUrl: `${SITE_URL}/?payment=cancelled`,
          failureUrl: `${SITE_URL}/?payment=failed`,
          metadata: { orderId: order.id, customerEmail: customer.email },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.redirectUrl) {
        console.error('yoco error', res.status, data);
        return json({ error: 'Payment could not be started. Please try again or WhatsApp Luke.' }, 502);
      }
      order.checkoutId = data.id;
      const orders = await readOrders();
      orders.unshift(order);
      await writeOrders(orders);
      return json({ redirectUrl: data.redirectUrl, orderId: order.id });
    } catch (e) {
      console.error('yoco exception', e);
      return json({ error: 'Payment service unavailable. Please WhatsApp Luke to order.' }, 502);
    }
  }

  /* ---- Fallback: record as manual/unpaid order (pre-Yoco go-live) ---- */
  order.status = 'Pending';
  order.paymentNote = 'Manual order — payment to be arranged via WhatsApp/EFT (Yoco not configured yet)';
  const orders = await readOrders();
  orders.unshift(order);
  // reserve stock
  state.products = state.products.map((p) => {
    const row = priced.rows.find((r) => r.id === p.id);
    return row ? { ...p, stock: Math.max(0, p.stock - row.qty) } : p;
  });
  await writeOrders(orders);
  await writeState(state);
  await sendEmail({
    to: customer.email, toName: customer.name,
    subject: `Order ${order.id} received — Luke's Good Lifestyle`,
    html: orderEmailHtml(order, 'Thanks for your order!', 'Luke will WhatsApp you to arrange payment and delivery. Now go smash a workout.'),
  });
  await sendEmail({
    to: process.env.ORDER_NOTIFY_EMAIL || 'ripponluke@gmail.com', toName: 'Luke',
    subject: `🛒 New order ${order.id} from ${customer.name} — ${order.total ? 'R' + order.total : ''}`,
    html: orderEmailHtml(order, 'New order on the site!', `From ${customer.name} · ${customer.phone} · ${customer.email}. Payment not yet collected (Yoco not configured).`),
  });
  return json({ demo: true, orderId: order.id });
};

export const config = { path: '/api/checkout' };
