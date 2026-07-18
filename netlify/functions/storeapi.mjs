/* /api/store — site catalog + special.
   GET  (public): products + special banner (drives the live shop).
   PUT  (admin):  update products and/or special. */
import { json, readState, writeState, requireAuth } from './lib/util.mjs';

export default async (req) => {
  if (req.method === 'GET') {
    const state = await readState();
    return json(state, 200, { 'cache-control': 'public, max-age=0, must-revalidate' });
  }

  if (req.method === 'PUT') {
    if (!(await requireAuth(req))) return json({ error: 'Not signed in.' }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const state = await readState();

    if (Array.isArray(body.products)) {
      state.products = body.products.map((p) => ({
        id: String(p.id),
        name: String(p.name || ''),
        tag: String(p.tag || ''),
        price: Math.max(0, Number(p.price) || 0),
        sale: p.sale === null || p.sale === '' ? null : Math.max(0, Number(p.sale) || 0),
        saleOn: !!p.saleOn,
        stock: Math.max(0, parseInt(p.stock, 10) || 0),
      }));
    }
    if (body.special && typeof body.special === 'object') {
      state.special = { active: !!body.special.active, text: String(body.special.text || '').slice(0, 300) };
    }
    await writeState(state);
    return json({ ok: true, state });
  }

  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/store' };
