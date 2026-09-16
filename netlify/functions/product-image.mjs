/* /api/product-image — admin-only product image upload.
   POST the raw image bytes with a content-type of image/webp, image/jpeg or
   image/png (the admin page converts and shrinks the picture first). The bytes
   are stored in Netlify Blobs under a content hash, so the returned URL never
   changes for the same image and can be cached forever. */
import { createHash } from 'node:crypto';
import { json, store, requireAuth } from './lib/util.mjs';

const TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_BYTES = 3 * 1024 * 1024;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!(await requireAuth(req))) return json({ error: 'Not signed in.' }, 401);

  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) return json({ error: 'Use a WebP, JPEG or PNG image.' }, 415);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return json({ error: 'The upload was empty.' }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: 'That image is too large (3MB maximum).' }, 413);

  const file = createHash('sha256').update(bytes).digest('hex').slice(0, 32) + '.' + ext;
  await store().set('img/' + file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return json({ ok: true, url: '/api/img?f=' + file, bytes: bytes.length });
};

export const config = { path: '/api/product-image' };
