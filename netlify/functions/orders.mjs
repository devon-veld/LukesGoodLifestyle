/* /api/orders — admin order management.
   GET  (admin): list orders, newest first.
   POST (admin): { action:'ship', id } -> mark shipped + notify customer. */
import { json, readOrders, writeOrders, requireAuth, sendEmail, orderEmailHtml } from './lib/util.mjs';

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
    return json({ error: 'unknown action' }, 400);
  }

  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/orders' };
