/* /api/orders — admin order management.
   GET  (admin): list orders, newest first.
   POST (admin): { action:'ship', id } -> mark shipped + notify customer.
                 { action:'delete', id } -> remove an order.
                 { action:'test-email' } -> send a sample order email to Luke. */
import { json, readOrders, writeOrders, requireAuth, sendEmail, orderEmailHtml, NOTIFY_EMAIL } from './lib/util.mjs';

export default async (req) => {
  if (!(await requireAuth(req))) return json({ error: 'Not signed in.' }, 401);

  if (req.method === 'GET') {
    const orders = await readOrders();
    return json({ orders });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (body.action === 'ship') {
      const orders = await readOrders();
      const o = orders.find((x) => x.id === body.id);
      if (!o) return json({ error: 'order not found' }, 404);
      o.status = 'Shipped';
      o.shippedAt = new Date().toISOString();
      await writeOrders(orders);
      if (o.customer && o.customer.email) {
        await sendEmail({
          to: o.customer.email, toName: o.customer.name,
          subject: `Your order ${o.id} has shipped 📦`,
          html: orderEmailHtml(o, 'Your order is on its way!', "Luke has shipped your order — you'll receive courier tracking on WhatsApp. Keep training hard!"),
        });
      }
      return json({ ok: true, order: o });
    }
    if (body.action === 'delete') {
      const orders = await readOrders();
      const next = orders.filter((x) => x.id !== body.id);
      if (next.length === orders.length) return json({ error: 'order not found' }, 404);
      await writeOrders(next);
      return json({ ok: true });
    }
    if (body.action === 'test-email') {
      const sample = {
        id: '#TEST', items: [{ name: "Luke's Good Gold", qty: 1, unit: 299 }], discount: 0, total: 299,
        customer: { name: 'Test customer', phone: '-', email: NOTIFY_EMAIL, address: 'Test address, Pretoria' },
      };
      const r = await sendEmail({
        to: NOTIFY_EMAIL, toName: 'Luke', subject: 'Test email from your website ✅',
        html: orderEmailHtml(sample, 'Order emails are working', 'This is a test from the admin dashboard. Real order emails look like this.'),
      });
      if (r.skipped) return json({ ok: false, error: 'Email is not set up yet: add SMTP_PASS in Netlify and redeploy.' }, 400);
      if (!r.ok) return json({ ok: false, error: 'Sending failed: ' + r.error }, 502);
      return json({ ok: true, to: NOTIFY_EMAIL });
    }
    return json({ error: 'unknown action' }, 400);
  }

  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/orders' };
