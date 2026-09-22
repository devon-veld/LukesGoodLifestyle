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
      const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F\uFFFD]/g, '').trim().slice(0, max);
      const num = (v) => Math.min(999999, Math.max(0, Number(v) || 0));
      // Images may only point at a file shipped with the site or an upload
      // stored by /api/product-image — never an arbitrary URL.
      const okImg = (v) => /^assets\/[A-Za-z0-9._/-]+$/.test(v) || /^\/api\/img\?f=[a-f0-9]{16,64}\.(webp|jpg|png)$/.test(v);

      const seen = new Set();
      const products = [];
      for (const p of body.products.slice(0, 24)) {
        const id = text(p.id, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        const name = text(p.name, 80);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        const img = text(p.img, 200);
        products.push({
          id,
          name,
          tag: text(p.tag, 120),
          desc: text(p.desc, 600),
          img: okImg(img) ? img : '',
          price: num(p.price),
          sale: p.sale === null || p.sale === '' || p.sale === undefined ? null : num(p.sale),
          saleOn: !!p.saleOn,
          stock: Math.min(999999, Math.max(0, parseInt(p.stock, 10) || 0)),
        });
      }
      if (!products.length) return json({ error: 'The shop needs at least one product.' }, 400);
      state.products = products;
    }
    if (body.shipping && typeof body.shipping === 'object') {
      state.shipping = {
        fee: Math.min(2000, Math.max(0, Number(body.shipping.fee) || 0)),
        freeOver: Math.min(100000, Math.max(0, Number(body.shipping.freeOver) || 0)),
      };
    }
    if (body.bundle && typeof body.bundle === 'object') {
      const seenQty = new Set();
      const tiers = (Array.isArray(body.bundle.tiers) ? body.bundle.tiers : [])
        .map((t) => ({ qty: parseInt(t.qty, 10) || 0, price: Math.min(999999, Math.max(0, Number(t.price) || 0)) }))
        .filter((t) => t.qty >= 2 && t.qty <= 24 && t.price > 0 && !seenQty.has(t.qty) && seenQty.add(t.qty))
        .sort((a, b) => a.qty - b.qty)
        .slice(0, 8);
      const productId = String(body.bundle.productId || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      state.bundle = {
        active: !!body.bundle.active,
        productId: state.products.some((p) => p.id === productId) ? productId : state.products[0].id,
        freeShippingFromQty: Math.min(24, Math.max(0, parseInt(body.bundle.freeShippingFromQty, 10) || 0)),
        tiers,
      };
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
