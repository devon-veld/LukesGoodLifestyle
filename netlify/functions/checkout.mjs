/* /api/checkout — create an order and start payment.
   POST { cart:[{id,qty}], customer:{name, phone, address, email} }

   With PAYSTACK_SECRET_KEY set: initialises a Paystack transaction and returns
                               { redirectUrl, reference } — customer pays on
                               Paystack, the webhook (or /api/paystack/verify)
                               marks the order paid.
   Without it (not yet live):  records the order as an unpaid manual order
                               ("Pending · EFT/WhatsApp") and sends the emails,
                               returning { demo:true } so the site still works. */
import {
  json, store, readState, writeState, readOrders, writeOrders, priceCart,
  sendEmail, orderEmailHtml, SITE_URL, NOTIFY_EMAIL,
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
  const priced = priceCart(body.cart, state.products, state);
  if (!priced.rows.length) return json({ error: 'Your cart is empty.' }, 400);

  // stock guard: never sell more than we have
  for (const row of priced.rows) {
    const p = state.products.find((x) => x.id === row.id);
    if (!p || p.stock <= 0) return json({ error: `${row.name} is sold out — WhatsApp Luke to reserve the next batch.` }, 409);
    if (row.qty > p.stock) return json({ error: `Only ${p.stock} × ${row.name} left in stock — please lower the quantity.` }, 409);
  }

  const order = {
    id: await nextOrderNumber(),
    createdAt: new Date().toISOString(),
    status: 'Awaiting payment',
    customer,
    items: priced.rows,
    subtotal: priced.subtotal,
    discount: priced.discount,
    discountLabel: priced.discountLabel,
    shipping: priced.shipping,
    total: priced.total,
  };

  const paystackKey = process.env.PAYSTACK_SECRET_KEY;

  if (paystackKey) {
    /* ---- Real Paystack transaction (hosted checkout page) ---- */
    // Paystack references: alphanumeric plus - . = only.
    order.reference = 'LGL-' + order.id.replace('#', '') + '-' + Date.now().toString(36);
    try {
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${paystackKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          email: customer.email,
          amount: Math.round(order.total * 100),   // cents
          currency: 'ZAR',
          reference: order.reference,
          callback_url: `${SITE_URL}/?payment=success&order=${encodeURIComponent(order.id)}`,
          metadata: {
            orderId: order.id,
            customerName: customer.name,
            customerPhone: customer.phone,
            custom_fields: [{ display_name: 'Order', variable_name: 'order', value: order.id }],
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.status || !data.data?.authorization_url) {
        console.error('paystack initialize error', res.status, data);
        return json({ error: 'Payment could not be started. Please try again or WhatsApp Luke.' }, 502);
      }
      order.paystackAccessCode = data.data.access_code;
      const orders = await readOrders();
      orders.unshift(order);
      await writeOrders(orders);
      return json({ redirectUrl: data.data.authorization_url, orderId: order.id, reference: order.reference });
    } catch (e) {
      console.error('paystack exception', e);
      return json({ error: 'Payment service unavailable. Please WhatsApp Luke to order.' }, 502);
    }
  }

  /* ---- Fallback: record as manual/unpaid order (pre-Paystack go-live) ---- */
  order.status = 'Pending';
  order.paymentNote = 'Manual order — payment to be arranged via WhatsApp/EFT (Paystack not configured yet)';
  const orders = await readOrders();
  orders.unshift(order);
  // reserve stock
  state.products = state.products.map((p) => {
    const row = priced.rows.find((r) => r.id === p.id);
    return row ? { ...p, stock: Math.max(0, p.stock - row.qty) } : p;
  });
  await writeOrders(orders);
  await writeState(state);
  await Promise.all([
    sendEmail({
      to: customer.email, toName: customer.name,
      subject: `Order ${order.id} received — Luke's Good Lifestyle`,
      html: orderEmailHtml(order, 'Thanks for your order!', 'Luke will WhatsApp you to arrange payment and delivery. Now go smash a workout.'),
    }),
    sendEmail({
      to: NOTIFY_EMAIL, toName: 'Luke', replyTo: customer.email,
      subject: `🛒 New order ${order.id} from ${customer.name} — ${order.total ? 'R' + order.total : ''}`,
      html: orderEmailHtml(order, 'New order on the site!', `From ${customer.name} · ${customer.phone} · ${customer.email}. Payment not yet collected (Paystack not configured).`),
    }),
  ]);
  return json({ demo: true, orderId: order.id });
};

export const config = { path: '/api/checkout' };
